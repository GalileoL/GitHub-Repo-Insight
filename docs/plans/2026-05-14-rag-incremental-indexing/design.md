# Design: RAG Incremental Indexing

> Implements: [`requirements.md`](./requirements.md)
> Research source: [`../2026-05-14-rag-incremental-indexing-spec.md`](../2026-05-14-rag-incremental-indexing-spec.md)

---

## 1. Architecture Overview

```
ingest(repo, commitSha, mode='incremental')
   │
   ├── fetchRepoTree(repo) ────────────► files[] {path, blobSha, size}
   ├── filter shouldIndexFile() ───────► candidates[]
   ├── fetchCodeSummaryIndex(repo) ────► existing: Map<path,{blobSha,chunkerVersion,chunkId}>
   ├── computeDiff(candidates, existing)► {toAdd, toDelete, toKeep, guardrailHit}
   ├── (toAdd) ► fetchContents ► buildChunks ► embedTexts ► upsertChunks
   ├── (toDelete, if within safety cap) ► deleteChunksByIds
   └── emit ingest_diff eval event
```

Existing-code touchpoints:
- `lib/rag/storage/index.ts` — add `fetchCodeSummaryIndex`, `deleteChunksByIds`.
- `lib/rag/chunking/code-summary.ts` — emit `chunkerVersion` in metadata.
- `lib/rag/types.ts` — extend `ChunkMetadata`.
- `lib/rag/ingest/code-summary.ts` (or equivalent orchestrator) — branch on `mode`.

## 2. Data Model

`ChunkMetadata` (extension, all optional for backward compat):
```ts
interface ChunkMetadata {
  // existing fields …
  lastIndexedSha?: string;       // blob SHA (already present)
  commitSha?: string;            // repo commit SHA (already present)
  chunkerVersion?: string;       // NEW — e.g. "code-summary@2"
  schemaVersion?: number;        // NEW — metadata structure version, default 1
  indexedAt?: number;            // NEW — Unix ms timestamp
}
```

Current `CHUNKER_VERSION` constant lives in `lib/rag/chunking/code-summary.ts`:
```ts
export const CHUNKER_VERSION = 'code-summary@1';
```
Bumping this value forces all chunks to be rebuilt on next incremental ingest (REQ-3).

## 3. Components

### 3.1 `fetchCodeSummaryIndex(repo)`
Returns a `Map<filePath, IndexedFileMeta>` summarizing the currently-indexed code chunks.
```ts
type IndexedFileMeta = {
  chunkId: string;
  blobSha: string;
  chunkerVersion?: string;
  indexedAt?: number;
};

export async function fetchCodeSummaryIndex(
  repo: string,
): Promise<Map<string, IndexedFileMeta>>;
```
- Uses Upstash `range({ prefix: '${repo}:code:', includeMetadata: true, includeVectors: false })`.
- Paginates via `nextCursor` until empty or chunk-count exceeds `HARD_LIMIT_CHUNKS`.
- Returns empty Map on error (caller treats as "first index" and full-rebuilds).

### 3.2 `computeDiff(candidates, existing, currentChunkerVersion)`
Pure function, fully unit-testable.
```ts
type Diff = {
  toAdd: CandidateFile[];     // new + changed + chunker-version-mismatch
  toKeep: string[];           // chunkIds untouched
  toDelete: string[];         // chunkIds to remove
  guardrailHit: boolean;      // true if toDelete exceeds safety cap
};
```
Rules:
- `existing[path]` missing OR `blobSha` differs OR `chunkerVersion` differs → `toAdd`.
- `existing[path]` present AND blobSha+chunkerVersion match → `toKeep`.
- `existing` keys not in candidates → `toDelete`.

### 3.3 `deleteChunksByIds(ids)`
Thin wrapper over Upstash `delete({ ids })`, batched 100 per call.

### 3.4 Ingest orchestrator changes
```ts
async function ingestCodeSummaries(repo, commitSha, mode='incremental') {
  const candidates = await collectCandidates(repo);

  if (mode === 'full' || process.env.RAG_FORCE_FULL_REINDEX === '1') {
    return runFullIngest(repo, candidates, commitSha);
  }

  let existing: Map<string, IndexedFileMeta>;
  try {
    existing = await fetchCodeSummaryIndex(repo);
  } catch (err) {
    log.warn({err}, 'incremental index scan failed; falling back to full');
    return runFullIngest(repo, candidates, commitSha, {fallbackReason: 'index_scan_failed'});
  }

  if (existing.size > HARD_LIMIT_CHUNKS) {
    return runFullIngest(repo, candidates, commitSha, {fallbackReason: 'chunk_limit_exceeded'});
  }

  const diff = computeDiff(candidates, existing, CHUNKER_VERSION);

  const contents  = await fetchFileContents(diff.toAdd);
  const chunks    = buildCodeSummaryChunks(contents, commitSha);
  const vectors   = await embedTexts(chunks.map(c => c.content));

  // P0 — upsert MUST happen before delete (REQ-7)
  await upsertChunks(zipChunksVectors(chunks, vectors));

  if (!diff.guardrailHit) {
    await deleteChunksByIds(diff.toDelete);
  } else {
    log.error({attempted: diff.toDelete.length, existing: existing.size}, 'delete guardrail tripped');
  }

  emitIngestDiff({ … });
}
```

## 4. Safety Constants

```ts
const MAX_DELETE_RATIO    = 0.2;
const MAX_DELETE_ABSOLUTE = 10;
const HARD_LIMIT_CHUNKS   = 50_000;
```

Guardrail decision:
```ts
const cap = Math.max(MAX_DELETE_ABSOLUTE, MAX_DELETE_RATIO * existing.size);
const guardrailHit = toDelete.length > cap;
```

## 5. Sequence: crash safety (REQ-7)

```
T0  begin ingest
T1  upsertChunks(toAdd)   ──► ok        (state: old chunks + new overlapping chunks)
T2  deleteChunksByIds(toDelete) ──► ok  (state: clean)

If crash between T1 and T2:
   index still serves answers (overlapping ok); next ingest naturally converges.

Inverted order (delete-then-upsert) is REJECTED because:
   crash between delete and upsert → recall hole (referenced files vanish).
```

## 6. Observability

Eval event `ingest_diff` written to existing eval pipeline:
```ts
{
  event: 'ingest_diff',
  repo, commitSha,
  filesTotal, filesAdded, filesKept, filesDeleted,
  embedCallCount,
  embedTokensEstimate,   // sum(content.length) / 4
  durationMs,
  guardrailHit: boolean,
  fallbackReason?: 'index_scan_failed' | 'chunk_limit_exceeded' | 'force_full',
}
```

Admin report new KPIs (existing daily-report pipeline):
- 7-day rolling avg of `filesAdded / filesTotal` (health: <0.10)
- 7-day rolling sum of saved embedding tokens estimate

## 7. Error Handling Matrix

| Failure point          | Behavior                                    |
|------------------------|---------------------------------------------|
| GitHub tree fetch      | propagate error, no partial writes          |
| `fetchCodeSummaryIndex`| fallback to full, log `index_scan_failed`   |
| `embedTexts`           | propagate via `EmbedError`, no upsert       |
| `upsertChunks` partial | re-throw; delete step skipped               |
| `deleteChunksByIds`    | log error, do not retry inside this ingest  |

## 8. Test Strategy

- **Unit**: `computeDiff` exhaustive — add/keep/delete/rename/chunker-version-mismatch/guardrail scenarios.
- **Unit**: `fetchCodeSummaryIndex` pagination, error→empty-map, chunk-limit abort.
- **Integration (mock Upstash + mock OpenAI)**:
  - Two-pass ingest, second pass has zero embedding calls.
  - Single-file edit pass produces exactly one upsert, all other chunks byte-identical.
  - Forced full mode bypasses diff.
  - Guardrail trip leaves index intact.
- **Smoke**: real ingest of this repo twice; second pass <30s, zero embedding calls.

## 9. Rollout

1. Land code with `mode='incremental'` default but ENV `RAG_FORCE_FULL_REINDEX=1` set in production for first 24h to observe `ingest_diff` events.
2. After validation, unset the ENV switch; incremental becomes live default.
3. Keep ENV as permanent escape hatch (NFR-3).

## 10. Open Decisions Resolved

- Rename optimization (metadata-only update when blobSha unchanged but path moved): deferred to Phase 2.
- Cross-commit chunk reuse: allowed — `commitSha` updated on every ingest of the same blobSha.
