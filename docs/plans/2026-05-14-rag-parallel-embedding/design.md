# Design: Parallel Batch Embedding

> Implements: [`requirements.md`](./requirements.md)
> Research source: [`../2026-05-14-rag-parallel-embedding-spec.md`](../2026-05-14-rag-parallel-embedding-spec.md)

---

## 1. Architecture Overview

```
embedTexts(texts)
   │
   ├── chunk into batches of BATCH (512)
   ├── pre-split oversized batches (REQ-3)
   ├── push each batch as a Job into ConcurrencyPool (MAX_CONCURRENCY)
   │     └── Job = embedOneBatchWithRetry(inputs, idx, timeoutMs)
   │           ├── try OpenAI call with race-against-timeout
   │           ├── on 429/5xx/timeout → retry with exp. backoff (REQ-4)
   │           ├── on 4xx other → throw EmbedError (REQ-5)
   │           └── on success → return vectors
   ├── as each job resolves, write vectors into pre-sized result[idx + j]
   └── emit embed_batch eval event
```

Existing-code touchpoint: `lib/rag/embeddings/index.ts:22` is fully rewritten; the public signature stays:
```ts
export async function embedTexts(texts: string[]): Promise<number[][]>;
```

## 2. Module Layout

```
lib/rag/embeddings/
  index.ts            ← rewritten public entry
  pool.ts             ← NEW ConcurrencyPool
  retry.ts            ← NEW backoff + retry-classify helpers
  error.ts            ← NEW EmbedError
```

## 3. Constants & Configuration

```ts
const BATCH                 = 512;
const MAX_CONCURRENCY       = clamp(parseInt(process.env.RAG_EMBED_CONCURRENCY ?? '4'), 1, 16);
const PER_BATCH_TIMEOUT_MS  = 30_000;
const TIMEOUT_GROWTH_FACTOR = 1.5;
const PER_BATCH_TIMEOUT_CAP = 60_000;
const MAX_RETRIES           = 3;
const PRE_SPLIT_TOKEN_LIMIT = 6_000;   // char/4 estimate
```

`clamp` returns `default=4` on `NaN` and emits a warn log.

## 4. ConcurrencyPool (`pool.ts`)

Zero-dep, FIFO, slot-based.

```ts
export class ConcurrencyPool {
  private active = 0;
  private queue: (() => void)[] = [];
  constructor(private max: number) {}

  async run<T>(job: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await job();
    } finally {
      this.release();   // REQ-7 — MUST be in finally
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.queue.push(() => { this.active++; resolve(); }));
  }
  private release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }

  // Exposed for tests only
  get activeCount(): number { return this.active; }
}
```

Invariants:
- `active` never exceeds `max`.
- Every successful `acquire()` is paired with exactly one `release()` (guaranteed by try/finally).
- A thrown job propagates to the caller of `pool.run`; the slot is still released.

## 5. Pre-split (REQ-3)

```ts
function splitOversized(inputs: string[]): string[][] {
  const tokens = inputs.reduce((s, t) => s + t.length, 0) / 4;
  if (tokens <= PRE_SPLIT_TOKEN_LIMIT || inputs.length === 1) return [inputs];
  const mid = inputs.length >> 1;
  return [...splitOversized(inputs.slice(0, mid)), ...splitOversized(inputs.slice(mid))];
}
```

Edge cases:
- Single input over the limit: returned as-is (OpenAI will 400; surfaced via `EmbedError`).
- Empty list: returns `[]`.

## 6. Retry + Timeout (`retry.ts`)

```ts
async function embedOneBatchWithRetry(
  inputs: string[],
  startIndex: number,
): Promise<number[][]> {
  let attempt = 0;
  let timeoutMs = PER_BATCH_TIMEOUT_MS;
  while (true) {
    try {
      return await withTimeout(callOpenAI(inputs), timeoutMs);
    } catch (err) {
      if (!isRetriable(err) || attempt >= MAX_RETRIES) {
        throw toEmbedError(err, startIndex, startIndex + inputs.length);
      }
      const backoff = Math.min(500 * 2 ** attempt, 8_000) + Math.random() * 300;
      await sleep(backoff);
      attempt++;
      timeoutMs = Math.min(timeoutMs * TIMEOUT_GROWTH_FACTOR, PER_BATCH_TIMEOUT_CAP);
    }
  }
}

function isRetriable(err: unknown): boolean {
  if (err instanceof TimeoutError) return true;
  if (isHttpError(err)) {
    return err.status === 429 || err.status >= 500;
  }
  return false;
}
```

## 7. EmbedError (`error.ts`)

```ts
export class EmbedError extends Error {
  readonly batchStartIndex: number;
  readonly batchEndIndex: number;             // exclusive
  readonly offendingInputIndex?: number;      // populated when OpenAI returns index
  readonly httpStatus?: number;
  readonly cause?: unknown;

  constructor(opts: { … }) { super(opts.message); /* assign */ }
}
```

Downstream callers (ingest orchestrator) can choose fail-fast or skip-and-continue, per design of incremental-indexing feature.

## 8. Public Entry (`index.ts`)

```ts
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  // Step 1: chunk by BATCH count
  const rawBatches: { idx: number; inputs: string[] }[] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    rawBatches.push({ idx: i, inputs: texts.slice(i, i + BATCH) });
  }

  // Step 2: token-aware pre-split
  const batches: { idx: number; inputs: string[] }[] = [];
  for (const b of rawBatches) {
    let cursor = b.idx;
    for (const piece of splitOversized(b.inputs)) {
      batches.push({ idx: cursor, inputs: piece });
      cursor += piece.length;
    }
  }

  // Step 3: short-circuit single-batch case
  if (batches.length === 1) {
    return embedOneBatchWithRetry(batches[0].inputs, 0);
  }

  // Step 4: concurrent execution with ordered write-back
  const results = new Array<number[]>(texts.length);
  const pool = new ConcurrencyPool(MAX_CONCURRENCY);
  const start = Date.now();
  const stats = { retries: 0, failedBatches: 0 };

  await Promise.all(
    batches.map((b) =>
      pool.run(() => embedOneBatchWithRetry(b.inputs, b.idx)).then((vecs) => {
        for (let j = 0; j < vecs.length; j++) results[b.idx + j] = vecs[j];
      }),
    ),
  );

  emitEvalEvent('embed_batch', {
    batchCount: batches.length,
    inputCount: texts.length,
    concurrency: MAX_CONCURRENCY,
    durationMs: Date.now() - start,
    ...stats,
  });

  return results;
}
```

Notes:
- The `retries`/`failedBatches` counters live in a closure shared with `embedOneBatchWithRetry` (omitted above for brevity; implemented via callback or shared object).

## 9. Error Handling Matrix

| Error case                              | Behavior                                    |
|-----------------------------------------|---------------------------------------------|
| OpenAI 429                              | retry with backoff, up to 3                 |
| OpenAI 5xx                              | retry with backoff, up to 3                 |
| OpenAI 4xx other (400, 401, 404)        | throw `EmbedError` immediately              |
| Timeout per batch                       | retry with backoff and grown timeout, up to 3 |
| All retries exhausted                   | throw `EmbedError`; `embedTexts` rejects    |
| Network reset / DNS                     | retry (treated as 5xx-equivalent)           |
| Job throws unexpectedly                 | slot still released (REQ-7)                 |

## 10. Sequence: out-of-order completion (REQ-2)

```
T0  enqueue batches [0..511]@idx=0, [512..1023]@idx=512, [1024..1499]@idx=1024
T1  batch idx=512 resolves first → write to results[512..1023]
T2  batch idx=1024 resolves    → write to results[1024..1499]
T3  batch idx=0 resolves last  → write to results[0..511]
T4  Promise.all settles        → return results (fully ordered)
```

## 11. Observability

Eval event `embed_batch` joins the existing eval bucket flow. Admin report adds:
- 24h avg per-100-input embed latency
- retry rate (health: <2%)
- 429 hits per day

## 12. Test Strategy

- **Unit tests** in `test/unit/lib/rag/embeddings/`:
  - `pool.test.ts`: invariant tests for `ConcurrencyPool` including AC-7 (5 throws then re-enqueue).
  - `retry.test.ts`: each retry / classify branch.
  - `split.test.ts`: pre-split correctness, total inputs preserved, edge cases.
  - `index.test.ts`: AC-1 through AC-6, AC-8.
- **Integration test** (mock OpenAI): 1 500-input call with artificial delay on batch 0 verifies out-of-order completion + correct ordering (AC-4).
- **Smoke test**: real ingest at `RAG_EMBED_CONCURRENCY={1, 4, 8}`, capture timings (AC-9).

## 13. Rollout

1. Land code with default `MAX_CONCURRENCY=4`.
2. Observe `embed_batch` metrics for 24h.
3. If 429 rate <1%, document option to tune up to 8 for power users.
4. Rollback path: set `RAG_EMBED_CONCURRENCY=1` to fully serialize without code revert.
