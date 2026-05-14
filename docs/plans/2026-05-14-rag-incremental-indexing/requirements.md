# Requirements: RAG Incremental Indexing

> Feature: incremental indexing of `code_summary` chunks
> Owner: RAG indexing pipeline
> Status: Ready for implementation
> Related research: [`../2026-05-14-rag-incremental-indexing-spec.md`](../2026-05-14-rag-incremental-indexing-spec.md)

---

## 1. Introduction

When a repository is re-indexed, the current pipeline rebuilds every `code_summary` chunk regardless of whether the file changed. On stable repos with hundreds of files, this wastes >90% of OpenAI embedding calls and Upstash upserts. This feature adds incremental indexing keyed by GitHub blob SHA, embedding only files whose content actually changed.

## 2. User Stories

- **US-1** As a **repo owner re-indexing the same repo within a week**, I want the second ingest to skip unchanged files so that I do not pay for redundant embedding calls.
- **US-2** As a **developer iterating on the chunker logic**, I want all chunks produced by an older chunker version to be rebuilt automatically, so that improvements ship without manual reindex.
- **US-3** As an **operator**, I want a hard safety cap on bulk deletes so that a transient GitHub tree-API glitch cannot wipe my index.
- **US-4** As an **operator**, I want a one-flip ENV switch to force full re-index, so that I can recover from any corrupted state.
- **US-5** As an **on-call**, I want metrics for `filesAdded / filesKept / filesDeleted` per ingest so that I can detect anomalies.

## 3. Functional Requirements (EARS)

- **REQ-1** WHEN `mode='incremental'` and a candidate file's `blobSha` matches the indexed `lastIndexedSha` AND `chunkerVersion` matches the current version, THE SYSTEM SHALL NOT call `embedTexts` for that file and SHALL leave its existing chunk intact.
- **REQ-2** WHEN a candidate file's `blobSha` differs from indexed `lastIndexedSha`, THE SYSTEM SHALL place it in `toAdd` and re-embed + upsert its chunk.
- **REQ-3** WHEN a candidate file's `chunkerVersion` differs from the current code, THE SYSTEM SHALL place it in `toAdd` regardless of blobSha match.
- **REQ-4** WHEN an indexed file is missing from the current candidate set, THE SYSTEM SHALL place it in `toDelete`.
- **REQ-5** IF the planned `toDelete` size exceeds `max(MAX_DELETE_RATIO × indexedCount, MAX_DELETE_ABSOLUTE)`, THEN THE SYSTEM SHALL skip the delete step, still execute `toAdd`, and emit an error-level log.
- **REQ-6** IF the indexed chunk count exceeds `HARD_LIMIT_CHUNKS` (50 000), THEN THE SYSTEM SHALL abort the index scan, fall back to full mode, and emit `fallbackReason='chunk_limit_exceeded'`.
- **REQ-7** THE SYSTEM SHALL execute `upsertChunks(toAdd)` strictly before `deleteChunksByIds(toDelete)` so that a mid-ingest crash never leaves stale-deleted-but-not-rewritten chunks.
- **REQ-8** IF `RAG_FORCE_FULL_REINDEX=1` is set OR the existing index map is empty OR `schemaVersion` is bumped, THEN THE SYSTEM SHALL run a full rebuild.
- **REQ-9** IF `fetchCodeSummaryIndex` throws, THEN THE SYSTEM SHALL fall back to full rebuild and emit `fallbackReason='index_scan_failed'`.
- **REQ-10** AT THE END of every ingest run, THE SYSTEM SHALL emit an `ingest_diff` eval event containing `filesTotal / filesAdded / filesKept / filesDeleted / embedCallCount / embedTokensEstimate / durationMs / fallbackReason?`.

## 4. Non-Functional Requirements

- **NFR-1 Performance**: For a repo where ≤5% of indexed files changed, ingest end-to-end runtime SHALL be ≤50% of the previous full-mode baseline.
- **NFR-2 Cost**: OpenAI embedding calls per re-ingest SHALL be proportional to changed files, not total files.
- **NFR-3 Crash safety**: A crash at any point in the ingest flow SHALL leave the index in a recall-correct state — repetition allowed, omission forbidden.
- **NFR-4 Backward compatibility**: Chunks written before this feature (missing `chunkerVersion`) SHALL be auto-rebuilt on first incremental run without manual migration.
- **NFR-5 Zero new dependencies.**

## 5. Out of Scope

- Incremental indexing for non-`code_summary` chunk types (commits, PRs, issues) — Phase 2 separate spec.
- Rename-as-metadata-update optimization — Phase 2.
- Token-accurate cost estimation — current estimate via `char/4`.

## 6. Acceptance Criteria

- AC-1 Re-running ingest on an unchanged commit produces `filesAdded=0`, `filesDeleted=0`, zero OpenAI calls.
- AC-2 Modifying one file then re-ingesting produces `filesAdded=1` and exactly one upsert; all other chunks have identical metadata pre/post (verified by `range` snapshot).
- AC-3 Forcing `RAG_FORCE_FULL_REINDEX=1` reverts to legacy behavior with no diff logic engaged.
- AC-4 Mocked test: when `fetchCodeSummaryIndex` indicates >20% deletes, no delete actually executes, toAdd still proceeds, error log captured.
- AC-5 Mocked test: when `indexedCount > 50 000`, full fallback triggers with the correct fallbackReason.
- AC-6 Bumping `chunkerVersion` constant in code triggers all files to be re-embedded on next ingest.
