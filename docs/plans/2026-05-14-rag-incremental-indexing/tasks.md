# Implementation Tasks: RAG Incremental Indexing

> Implements: [`design.md`](./design.md) for [`requirements.md`](./requirements.md)
> Each task lists target file(s), satisfied requirement(s), and an explicit done-when check.

---

## Phase 0 — Preparation

- [ ] **T0.1** Confirm Upstash `range` supports `prefix + includeMetadata + includeVectors:false + nextCursor` against current SDK version (`@upstash/vector`).
  - File: smoke script in `scripts/`
  - Satisfies: NFR-5
  - Done when: a script lists ≥ 1 page of existing `code_summary` chunks without fetching vectors.

## Phase 1 — Data Model

- [ ] **T1.1** Extend `ChunkMetadata` with `chunkerVersion?: string`, `schemaVersion?: number`, `indexedAt?: number`.
  - File: `lib/rag/types.ts`
  - Satisfies: REQ-3
  - Done when: `tsc` passes; type used in code-summary builder.
- [ ] **T1.2** Export `CHUNKER_VERSION = 'code-summary@1'` and write it into every produced chunk.
  - File: `lib/rag/chunking/code-summary.ts`
  - Satisfies: REQ-3, NFR-4
  - Done when: new chunks include `chunkerVersion: 'code-summary@1'` (verified by snapshot test).
- [ ] **T1.3** Update existing unit tests for `buildCodeSummaryChunks` to assert presence of the new metadata fields.
  - File: `test/unit/lib/rag/chunking/code-summary.test.ts`
  - Done when: all chunk-builder tests still green.

## Phase 2 — Storage helpers

- [ ] **T2.1** Implement `fetchCodeSummaryIndex(repo)` with cursor-based pagination and `HARD_LIMIT_CHUNKS` abort.
  - File: `lib/rag/storage/index.ts`
  - Satisfies: REQ-6, NFR-1
  - Done when: unit test with mocked Upstash returns full map across 3 pages; another test aborts when limit exceeded.
- [ ] **T2.2** Implement `deleteChunksByIds(ids: string[])`, batched 100 per call.
  - File: `lib/rag/storage/index.ts`
  - Satisfies: REQ-4
  - Done when: unit test verifies batching and that 0-length input is a no-op.

## Phase 3 — Diff logic

- [ ] **T3.1** Add `computeDiff(candidates, existing, currentChunkerVersion)` as a pure function.
  - File: `lib/rag/ingest/diff.ts` (new)
  - Satisfies: REQ-1, REQ-2, REQ-3, REQ-4
  - Done when: 8 unit tests cover all rule branches.
- [ ] **T3.2** Add guardrail computation `guardrailHit = toDelete.length > max(MAX_DELETE_ABSOLUTE, MAX_DELETE_RATIO * existing.size)`.
  - File: same as T3.1
  - Satisfies: REQ-5
  - Done when: dedicated unit test for trip and no-trip.

## Phase 4 — Orchestrator integration

- [ ] **T4.1** Add `mode: 'incremental' | 'full'` parameter (default `incremental`) to the code-summary ingest entry function.
  - File: `lib/rag/ingest/code-summary.ts` (or matching orchestrator)
  - Satisfies: REQ-8
  - Done when: function signature change does not break callers; existing tests still green.
- [ ] **T4.2** Wire the incremental path: tree → candidates → fetchIndex → diff → fetchContents → buildChunks → embed → **upsert (T4.3)** → delete (T4.4).
  - File: same as T4.1
  - Satisfies: REQ-1, REQ-2, REQ-7
- [ ] **T4.3** Enforce upsert-before-delete; assert in code (`upsertChunks` `await`ed before `deleteChunksByIds` call site).
  - File: same as T4.1
  - Satisfies: REQ-7 (P0)
  - Done when: integration test simulates a crash between upsert and delete and verifies no recall hole.
- [ ] **T4.4** Implement guardrail-aware delete: when `guardrailHit`, log error and skip delete.
  - File: same as T4.1
  - Satisfies: REQ-5
  - Done when: integration test triggers guardrail and verifies that delete was not called.
- [ ] **T4.5** Implement fallback paths: empty map → full; scan throws → full; chunk-limit → full. Each annotated with `fallbackReason`.
  - File: same as T4.1
  - Satisfies: REQ-6, REQ-9
- [ ] **T4.6** Honor `RAG_FORCE_FULL_REINDEX=1` env switch with highest priority.
  - File: same as T4.1
  - Satisfies: REQ-8

## Phase 5 — Observability

- [ ] **T5.1** Emit `ingest_diff` eval event with full payload defined in design §6.
  - File: existing eval write helpers
  - Satisfies: REQ-10, US-5
- [ ] **T5.2** Extend admin daily report aggregation to compute the two new KPIs.
  - File: existing admin report aggregator
  - Done when: KPI fields appear in next scheduled report run (or simulated via test).

## Phase 6 — Testing

- [ ] **T6.1** Integration test: two-pass ingest on identical commit produces zero embedding calls.
  - File: `test/integration/rag/incremental-indexing.test.ts` (new)
  - Satisfies: AC-1
- [ ] **T6.2** Integration test: single-file mutation produces exactly one upsert; verify all unmutated chunk metadata via `range` snapshot equality.
  - Satisfies: AC-2
- [ ] **T6.3** Integration test: guardrail trip leaves toDelete unexecuted, toAdd still applied.
  - Satisfies: AC-4
- [ ] **T6.4** Integration test: simulated `existing.size > 50_000` triggers full fallback with correct `fallbackReason`.
  - Satisfies: AC-5
- [ ] **T6.5** Integration test: bumping `CHUNKER_VERSION` in code causes all files to land in `toAdd`.
  - Satisfies: AC-6

## Phase 7 — Rollout & Docs

- [ ] **T7.1** Update `README.md` ingest section with incremental-mode behavior and the env escape hatch.
- [ ] **T7.2** Add `docs/plans/2026-05-14-rag-incremental-indexing/CHANGELOG.md` recording the `CHUNKER_VERSION` bump policy.
- [ ] **T7.3** Production rollout: deploy with `RAG_FORCE_FULL_REINDEX=1` for 24h; review `ingest_diff` events; then unset.

---

## Dependency Graph (must complete in order across phases)

```
Phase 0 → Phase 1 → Phase 2 ─┬─► Phase 3 ─► Phase 4 ─► Phase 5 ─► Phase 6 ─► Phase 7
                             └─► (T2.x feeds T4.x)
```

Tasks within a phase may run in parallel unless their `File` rows overlap.
