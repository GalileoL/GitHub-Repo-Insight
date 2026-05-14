# Requirements: Parallel Batch Embedding

> Feature: parallel + resilient OpenAI batch embedding
> Owner: RAG indexing pipeline
> Status: Ready for implementation
> Related research: [`../2026-05-14-rag-parallel-embedding-spec.md`](../2026-05-14-rag-parallel-embedding-spec.md)

---

## 1. Introduction

`embedTexts()` currently processes OpenAI embedding batches sequentially with no retry, no timeout, and no token-aware safety. A 3 000-input ingest is 6 round-trips. This feature parallelizes batches with a bounded concurrency pool, adds retry / timeout / error classification, and pre-splits oversized batches.

## 2. User Stories

- **US-1** As a **repo owner ingesting a large repo**, I want embedding-stage latency to scale sub-linearly with input count, so that ingest completes in minutes not tens of minutes.
- **US-2** As an **operator**, I want transient 429 / 5xx errors to retry automatically with backoff, so that a brief OpenAI hiccup does not fail an entire ingest.
- **US-3** As an **operator**, I want the concurrency level configurable via env, so that I can dial it back if my OpenAI tier RPM is tight.
- **US-4** As a **developer**, I want failed batches to surface their input-index range, so that downstream code can isolate the offending file in a fault-tolerant mode.
- **US-5** As an **operator**, I want metrics on retry rate and 429 count, so that I can spot deteriorating upstream conditions.

## 3. Functional Requirements (EARS)

- **REQ-1** WHEN `embedTexts(texts)` is invoked with `texts.length > BATCH`, THE SYSTEM SHALL execute batches concurrently up to `MAX_CONCURRENCY`.
- **REQ-2** THE SYSTEM SHALL preserve strict input-output ordering: the returned `number[][]` index `i` SHALL be the embedding of `texts[i]`.
- **REQ-3** BEFORE pushing a batch into the concurrency pool, IF the estimated token count (`sum(input.length)/4`) exceeds 6 000, THEN THE SYSTEM SHALL split the batch into halves recursively until each half is within budget.
- **REQ-4** WHEN a batch call returns 429 or 5xx OR times out, THE SYSTEM SHALL retry up to 3 times with exponential backoff `min(500 × 2^n, 8000) ms + jitter`.
- **REQ-5** WHEN a batch call returns 4xx (other than 429), THE SYSTEM SHALL NOT retry and SHALL throw an `EmbedError` containing the batch's input-index range.
- **REQ-6** WHEN all 3 retries fail, THE SYSTEM SHALL throw `EmbedError` and the overall `embedTexts` call SHALL reject; partial results SHALL NOT be returned.
- **REQ-7** THE concurrency pool SHALL release its slot in a `finally` block such that a thrown job cannot leak the slot.
- **REQ-8** THE SYSTEM SHALL read `RAG_EMBED_CONCURRENCY` env var and clamp to `[1, 16]`, defaulting to `4`; invalid values fall back to `4` with a warn log.
- **REQ-9** EACH batch SHALL have an independent timeout of `PER_BATCH_TIMEOUT_MS` (30 000 ms initial, multiplied by 1.5 on each retry, capped at 60 000 ms).
- **REQ-10** AT THE END of every `embedTexts` call, THE SYSTEM SHALL emit an `embed_batch` eval event with `repo, batchCount, inputCount, concurrency, durationMs, retries, failedBatches`.

## 4. Non-Functional Requirements

- **NFR-1 Performance**: For ≥ 1 000 inputs, end-to-end latency SHALL be ≤ 60% of sequential baseline at `MAX_CONCURRENCY=4`.
- **NFR-2 Correctness**: Output ordering identical to sequential implementation, byte-for-byte.
- **NFR-3 Zero new runtime dependencies** (no `p-limit`, no `bottleneck`).
- **NFR-4 Robustness**: A single thrown job MUST NOT cause the pool to deadlock; subsequent invocations succeed.
- **NFR-5 Observability**: Retry rate and 429 hits must be queryable from the daily admin report.

## 5. Out of Scope

- Token-accurate validation (tiktoken integration) — Phase 2.
- Cross-request global RPM governance — serverless context makes this low-value.
- Dynamic concurrency weighting — explicitly rejected (over-engineering).

## 6. Acceptance Criteria

- **AC-1** Unit test: `texts.length = 0` returns `[]`.
- **AC-2** Unit test: `texts.length = 300` (< BATCH) runs as a single direct call (pool not engaged).
- **AC-3** Unit test: `texts.length = 1500` produces 3 batches running concurrently; mock-induced delay on batch 0 does not block batches 1 and 2 from starting.
- **AC-4** Unit test: returned `number[][]` indexes align with input even when batch 0 finishes after batch 1.
- **AC-5** Unit test: first two calls return 429, third returns success → no error surfaces, retry counter increments.
- **AC-6** Unit test: 400 error throws `EmbedError` carrying `batchStartIndex` and `batchEndIndex`.
- **AC-7** Unit test: 5 consecutive jobs throw uncaught → pool's `activeCount` returns to 0; subsequent enqueue succeeds.
- **AC-8** Unit test: oversized batch (estimated 12 000 tokens) is pre-split into 2 halves before pool ingestion.
- **AC-9** Smoke: real ingest of this repo at `RAG_EMBED_CONCURRENCY=8` completes ≤ 60% of `RAG_EMBED_CONCURRENCY=1` baseline.
