# Implementation Tasks: Parallel Batch Embedding

> Implements: [`design.md`](./design.md) for [`requirements.md`](./requirements.md)

---

## Phase 1 — Module scaffolding

- [ ] **T1.1** Create `lib/rag/embeddings/pool.ts` with the `ConcurrencyPool` class and `activeCount` getter.
  - Satisfies: REQ-1, REQ-7, NFR-3
  - Done when: file compiles; `pool.test.ts` not yet written.
- [ ] **T1.2** Create `lib/rag/embeddings/error.ts` with `EmbedError` class carrying `batchStartIndex / batchEndIndex / offendingInputIndex? / httpStatus? / cause?`.
  - Satisfies: REQ-5, US-4
- [ ] **T1.3** Create `lib/rag/embeddings/retry.ts` with `isRetriable`, `withTimeout`, `toEmbedError`, and `embedOneBatchWithRetry`.
  - Satisfies: REQ-4, REQ-5, REQ-9

## Phase 2 — Pre-split helper

- [ ] **T2.1** Add `splitOversized(inputs: string[]): string[][]` in `lib/rag/embeddings/split.ts`.
  - Satisfies: REQ-3
  - Done when: unit tests cover budget boundary, single-oversized-item passthrough, empty list.

## Phase 3 — Rewrite public entry

- [ ] **T3.1** Replace `lib/rag/embeddings/index.ts` body with the design §8 implementation.
  - Satisfies: REQ-1, REQ-2, REQ-6, REQ-8, REQ-10
- [ ] **T3.2** Wire env-var parsing with `clamp(value, 1, 16)` and warn log on NaN.
  - Satisfies: REQ-8
- [ ] **T3.3** Emit `embed_batch` eval event from the entry function.
  - Satisfies: REQ-10, US-5

## Phase 4 — Unit tests

- [ ] **T4.1** `pool.test.ts`: invariants (active never exceeds max, slot released on throw, AC-7 sequence).
  - Satisfies: REQ-7, NFR-4, AC-7
- [ ] **T4.2** `retry.test.ts`: 429 retry chain, 400 immediate throw, timeout growth, retry budget exhaustion.
  - Satisfies: REQ-4, REQ-5, AC-5, AC-6
- [ ] **T4.3** `split.test.ts`: budget split correctness; sum of input lengths preserved.
  - Satisfies: REQ-3, AC-8
- [ ] **T4.4** `index.test.ts`: AC-1, AC-2, AC-3, AC-4 (out-of-order completion ordering verification).
  - Satisfies: REQ-1, REQ-2, REQ-6
- [ ] **T4.5** Env-clamp test: `RAG_EMBED_CONCURRENCY={'-1','0','99','foo','7'}` → `{1,1,16,4,7}`.
  - Satisfies: REQ-8

## Phase 5 — Integration smoke

- [ ] **T5.1** Local script `scripts/embed-bench.ts` that calls `embedTexts` with N synthetic inputs and prints latency at `MAX_CONCURRENCY={1,4,8}`.
  - Satisfies: AC-9, NFR-1
- [ ] **T5.2** Document the bench command in `README.md` Ops section.

## Phase 6 — Observability

- [ ] **T6.1** Extend admin daily report to compute retry rate and 429 hit counts from `embed_batch` events.
  - Satisfies: NFR-5, US-5

## Phase 7 — Rollout & Docs

- [ ] **T7.1** Default `MAX_CONCURRENCY=4` in production env. Document the env var.
- [ ] **T7.2** Add a section to `TROUBLESHOOTING.md`: "How to throttle embedding concurrency".
- [ ] **T7.3** Verify smoke result meets NFR-1 (≤ 60% baseline at concurrency=4).

---

## Dependency Graph

```
Phase 1 (independent) → Phase 2 ─┐
                                  ├─► Phase 3 → Phase 4 → Phase 5 → Phase 6 → Phase 7
                       Phase 1   ─┘
```

Phase 1 sub-tasks T1.1 / T1.2 / T1.3 may run in parallel (separate files).
