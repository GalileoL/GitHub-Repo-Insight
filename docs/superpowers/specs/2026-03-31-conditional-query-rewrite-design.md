# Conditional Query Rewrite for Ask Repo RAG

**Date:** 2026-03-31
**Status:** Approved
**Scope:** Backend retrieval pipeline (`lib/rag/retrieval/`, `lib/rag/llm/`, `api/rag/ask.ts`)

---

## Problem

The current RAG pipeline passes the user's question verbatim to hybrid search. This works well for clear, specific queries but produces poor retrieval for vague, multi-part, or architecture-level questions where the user's vocabulary doesn't match the indexed content.

## Solution

A conditional query rewrite system that:

1. Retrieves with the original query first
2. Scores query risk + retrieval confidence
3. Triggers one of four modes: `none`, `light`, `strong`, `strong-llm`
4. Merges original + rewritten results, dedupes, reranks against original query
5. Preserves citations and the existing answer flow

Design principle: **deterministic-first, selective LLM fallback only.**

---

## Architecture

### Approach: Rewrite-as-middleware (Approach A)

```
ask.ts (orchestrator)
  ├── classifyQuery()              ← router.ts (unchanged)
  ├── hybridSearch(original)       ← hybrid.ts (see note on rerank)
  ├── analyzeAndRewrite()          ← rewrite.ts (NEW)
  │     ├── analyzeQuery()
  │     ├── computeConfidence()
  │     ├── makeRewriteDecision()
  │     └── generateCandidates()
  ├── hybridSearch(candidate...)   ← hybrid.ts (parallel fan-out)
  ├── mergeResults()               ← merge.ts (NEW)
  ├── rerank(merged, original)     ← rerank.ts (unchanged)
  └── generateAnswer/Stream()      ← llm/index.ts (unchanged)
```

**Important: `hybridSearch` already calls `rerank` internally.** The current `hybrid.ts` returns reranked results (RRF fusion → `rerank(merged, query, topK)`). This means:

- First-pass results fed to `computeConfidence` carry rerank-boosted scores (recency, length, title match boosts applied). The `scoreSource` should be `'rerank_boosted'`.
- Rewrite-candidate passes also return reranked results from their own `hybridSearch` calls.
- The final `rerank(merged, original)` step in ask.ts is a **second rerank pass** on the merged set. This is intentional: the per-query reranks optimize each query's results independently, while the final rerank re-scores the merged pool against the original query. The rerank function applies small additive boosts (max ~0.25) on top of the merge score, so double-application shifts absolute scores slightly but does not change relative ordering significantly.
- Thresholds for `computeConfidence` are calibrated against rerank-boosted scores, not raw RRF scores. This is the expected input.

To keep `hybrid.ts` unchanged, we accept the double-rerank trade-off. If profiling later shows this distorts rankings, we can extract a `hybridSearchRaw()` variant that returns pre-rerank RRF scores.

### File layout

| File | Change | Responsibility |
|------|--------|---------------|
| `lib/rag/retrieval/rewrite.ts` | **New (~250 lines)** | Query analysis, risk scoring, decision engine, candidate generation |
| `lib/rag/retrieval/merge.ts` | **New (~80 lines)** | Merge multi-pass results, dedupe by chunk ID, diagnostic snapshots |
| `lib/rag/types.ts` | **Additions (~80 lines)** | New interfaces for rewrite pipeline |
| `lib/rag/llm/index.ts` | **Addition (~30 lines)** | `rewriteQueries()` for strong-llm mode |
| `api/rag/ask.ts` | **Modified (~40 net new)** | Orchestration of rewrite pipeline; extract `category` from `classifyQuery` |
| `router.ts`, `hybrid.ts`, `vector.ts`, `keyword.ts`, `rerank.ts` | **Unchanged** | — |
| Frontend code, SSE contract | **Unchanged** | — |

---

## Data Model

### Query Analysis

```typescript
interface QueryAnchors {
  filePaths: string[];      // e.g. "src/utils/auth.ts"
  endpoints: string[];      // e.g. "/api/rag/ask", "GET /users"
  codeSymbols: string[];    // e.g. "hybridSearch", "ScoredChunk"
  directories: string[];    // e.g. "lib/rag/retrieval/"
}

interface AnchorDiscount {
  appliedMultiplier: number;        // e.g. 0.5
  anchorType: keyof QueryAnchors;   // which type triggered it
  rawRiskScore: number;
  discountedRiskScore: number;
}

interface QueryRiskSignals {
  isVague: boolean;
  isComplex: boolean;
  hasNegation: boolean;
  isComparative: boolean;
  hasImplicitContext: boolean;
}

interface QueryAnalysis {
  original: string;
  anchors: QueryAnchors;
  riskSignals: QueryRiskSignals;
  riskScore: number;                    // 0.0–1.0, after anchor discount
  anchorDiscount: AnchorDiscount | null;
  category: QueryCategory;
}
```

### Retrieval Confidence

```typescript
// 'hybrid_rrf':      raw RRF fusion scores (before rerank) — not currently exposed
// 'rerank_boosted':  scores after hybridSearch's internal rerank pass — current default
// 'normalized':      reserved for future use (e.g. post-merge normalized scores)
type ScoreSource = 'hybrid_rrf' | 'rerank_boosted' | 'normalized';

interface RetrievalConfidence {
  topScore: number;
  scoreGap: number;
  coverageRatio: number;
  avgScore: number;
  confidenceScore: number;    // 0.0–1.0 composite
  scoreSource: ScoreSource;
}
```

`scoreSource` tracks which scoring stage produced the inputs so thresholds can later be calibrated per source. Since `hybridSearch` returns rerank-boosted scores, the default `scoreSource` in practice is `'rerank_boosted'`.

**Empty results:** If `results` is empty, `computeConfidence` returns all scores at 0.0 and `confidenceScore` at 0.0, with the provided `scoreSource`.

### Rewrite Decision

```typescript
type RewriteMode = 'none' | 'light' | 'strong' | 'strong-llm';

type ReasonCode =
  | 'vague_query' | 'complex_query' | 'negation_present'
  | 'comparative_query' | 'implicit_context'
  | 'low_top_score' | 'small_score_gap' | 'low_coverage' | 'low_avg_score'
  | 'anchors_present' | 'high_confidence';

interface RewriteThresholds {
  light: number;            // default 0.3
  strong: number;           // default 0.55
  llm: number;              // default 0.8
  confidenceFloor: number;  // default 0.3, required for strong-llm
  consensusBonus: number;   // default 0.05, per additional source query
}

interface RewriteDecision {
  mode: RewriteMode;
  reasonCodes: ReasonCode[];
  reason: string;
  rewriteScore: number;
  thresholds: RewriteThresholds;
}
```

### Rewrite Candidates

```typescript
type RewriteStrategy = 'synonym' | 'decompose' | 'expand' | 'llm';

interface RewriteCandidate {
  query: string;
  strategy: RewriteStrategy;
  preservedAnchors: QueryAnchors;   // typed, not flat string array
}

interface RewriteResult {
  decision: RewriteDecision;
  candidates: RewriteCandidate[];   // empty if mode === 'none'
  analysis: QueryAnalysis;
}
```

### Merge

```typescript
interface MergedChunk {
  chunk: Chunk;
  originalScore: number | null;
  rewriteScores: Record<number, number>; // candidateIndex → score
  mergedScore: number;                    // pre-rerank score
  sourceQueries: string[];
  fromOriginal: boolean;
}
```

### Diagnostics

```typescript
interface RetrievalSnapshot {
  topScore: number;
  avgScore: number;
  chunkIds: string[];
  coverageRatio: number;
}

interface RetrievalComparison extends RetrievalSnapshot {
  newChunkIds: string[];
  droppedChunkIds: string[];
  overlapRatio: number;
}

interface RetrievalDiagnostics {
  requestId: string;
  originalQuery: string;
  repo: string;
  analysis: QueryAnalysis;
  firstPassConfidence: RetrievalConfidence;
  decision: RewriteDecision;
  candidates: RewriteCandidate[];
  beforeRewrite: RetrievalSnapshot;
  afterRewrite: RetrievalComparison | null;
  timing: {
    totalRetrievalMs: number;
    firstPassMs: number;
    rewriteDecisionMs: number;
    rewriteSearchMs: number;
    llmRewriteMs: number | null;
    mergeMs: number;
    rerankMs: number;
  };
  counts: {
    firstPassChunks: number;
    mergedChunks: number;
    deduplicatedChunks: number;
    finalChunks: number;
  };
}
```

---

## Scoring Logic

### Query Risk Score (0.0–1.0)

Weighted sum of boolean risk signals:

| Signal | Weight | Rationale |
|--------|--------|-----------|
| `isVague` | 0.30 | Short/generic queries cause the most retrieval damage |
| `isComplex` | 0.25 | Multi-part questions need decomposition |
| `hasImplicitContext` | 0.20 | Pronouns/references without antecedent |
| `isComparative` | 0.15 | "vs"/"compare" often need multiple sub-queries |
| `hasNegation` | 0.10 | Embedding models handle negation poorly |

**Anchor discount** — applied after the weighted sum. Take the lowest applicable multiplier (discounts do NOT stack):

| Anchor type | Multiplier |
|-------------|-----------|
| `filePaths` present | × 0.5 |
| `endpoints` present | × 0.6 |
| `codeSymbols` present | × 0.7 |
| `directories` present | × 0.7 |

The chosen multiplier and anchor type are recorded in `AnchorDiscount` for diagnostics.

### Retrieval Confidence Score (0.0–1.0)

| Component | Weight | Notes |
|-----------|--------|-------|
| `topScore` (normalized) | 0.35 | Is the best result relevant? |
| `scoreGap` (top1 − top2) | 0.25 | Is there a clear winner? |
| `coverageRatio` | 0.25 | Multiple results above relevance floor? |
| `avgScore` (normalized) | 0.15 | General quality floor |

All inputs normalized to 0–1 within the result set. The `scoreSource` field tracks provenance so thresholds can be calibrated per source.

### Combined Rewrite Score

```
rewriteScore = (riskScore × 0.6) + ((1 - confidenceScore) × 0.4)
```

### Mode Thresholds

| Mode | Interval | Condition |
|------|----------|-----------|
| `none` | [0, 0.3) | Clear query, confident retrieval |
| `light` | [0.3, 0.55) | Minor risk or slightly weak retrieval |
| `strong` | [0.55, 0.8) | Significant risk or poor retrieval |
| `strong-llm` | [0.8, 1.0] | High risk + poor retrieval + no anchors |

**`strong-llm` guard — ALL three conditions required:**

1. `rewriteScore ≥ 0.8`
2. `confidenceScore < 0.3`
3. All anchor arrays empty

If any anchor exists → cap at `strong`. The LLM fallback is a sub-mode of strong, not a separate strategy.

---

## Rewrite Modes

### `none`
Return original query only. Zero overhead.

### `light`
- **Synonym expansion:** "auth" → "authentication", "deps" → "dependencies"
- **Vocabulary normalization:** common abbreviations to full terms
- Returns **1 candidate** (2 queries total with original)

### `strong`
- Everything in `light`, plus:
- **Query decomposition:** split multi-part questions into focused sub-queries
- **Concept expansion:** add implementation-level terms
- Returns **2–3 candidates** (3–4 queries total)

### `strong-llm`
- Same intent as `strong`, but candidates generated by a single LLM call
- LLM instructed to produce 2–3 semantically distinct reformulations
- Anchors injected into prompt as "preserve these terms verbatim" constraints
- Returns **2–3 candidates** (3–4 queries total)

**Fallback on LLM failure:** If `rewriteQueries()` throws or returns an empty array, fall back to `strong` mode's deterministic candidates. The failure is logged in diagnostics (`timing.llmRewriteMs` records the failed attempt duration, and a `'llm_fallback_to_strong'` note is added to `reason`). This ensures the pipeline never stalls on the highest-risk queries.

---

## Detection Heuristics

### Vagueness
- Word count ≤ 3 after stopword removal
- No anchors of any type
- Matches: "tell me about", "explain", "show me"

### Complexity
- Conjunctions splitting distinct topics: "and", "but also", "as well as"
- Word count > 15
- Multiple question marks
- Matches: "architecture", "design", "how does X interact with Y"

### Implicit context
- Starts with pronouns: "it", "they", "that", "this"
- Contains: "the above", "mentioned", "previous"

### Anchor extraction

| Type | Pattern |
|------|---------|
| `filePaths` | `/[\w.-]+\/[\w.-]+\.\w{1,5}/` |
| `endpoints` | `/(?:GET\|POST\|PUT\|DELETE\|PATCH)\s+\/[\w/.-]+\|\/api\/[\w/.-]+/i` |
| `codeSymbols` | Backtick-wrapped identifiers or PascalCase/camelCase tokens not matching file paths |
| `directories` | Trailing-slash paths or common patterns like `lib/`, `src/` |

---

## Merge Strategy

### Score computation

```
mergedScore = max(originalScore ?? 0, ...rewriteScores.values())
            + (sourceCount - 1) × consensusBonus
```

- **Max-wins:** best score from any query variant is the base
- **Consensus bonus:** +0.05 (configurable) per additional query that retrieved this chunk
- `mergedScore` is a pre-rerank retrieval score — rerank logic applies its own boosts on top

### Deduplication
- Exact-ID dedup via `Map<string, MergedChunk>` keyed by `chunk.id`
- No fuzzy content dedup (chunk IDs are deterministic from ingestion)

### Original query priority
- When `mergedScore` values are tied within 0.01, prefer chunks from first pass (`fromOriginal: true`)
- This is a tie-breaker only, not a broad bias

### Rerank
- Runs on merged set projected to `ScoredChunk[]`
- Always reranks against the **original query** (not rewrite variants)
- Existing `rerank.ts` is unchanged

---

## Orchestration in ask.ts

```
t0  classifyQuery(question) → { category, typeFilter } ~0ms
t1  hybridSearch(original, repo, 8, typeFilter)        ~200-400ms  (returns rerank-boosted scores)
t2  analyzeAndRewrite(question, category, results)     ~0ms deterministic / ~500ms strong-llm
t3  hybridSearch(candidate1, ...)  }
    hybridSearch(candidate2, ...)  } parallel           ~200-400ms
t4  mergeResults(firstPass, rewritePasses)              ~0ms
t5  rerank(merged, original, topK)                      ~0ms  (second rerank pass, against original query)
t6  generateAnswer/Stream(question, repo, final)        LLM streaming
```

Note: `t0` must destructure both `category` and `typeFilter` from `classifyQuery` (current code only extracts `typeFilter`).

**Added latency by mode:**

| Mode | Extra latency | Extra embedding calls |
|------|--------------|----------------------|
| `none` | ~0ms | 0 |
| `light` | ~200-400ms | 1 |
| `strong` | ~200-400ms | 2–3 (parallel) |
| `strong-llm` | ~700-900ms | 2–3 (parallel) + 1 LLM call |

The `none` path adds essentially zero overhead — synchronous `analyzeQuery` + `computeConfidence` + `makeRewriteDecision`.

---

## Public API

### rewrite.ts

```typescript
export function analyzeQuery(query: string, category: QueryCategory): QueryAnalysis;
export function computeConfidence(results: ScoredChunk[], scoreSource: ScoreSource): RetrievalConfidence;
export function makeRewriteDecision(
  analysis: QueryAnalysis,
  confidence: RetrievalConfidence,
  thresholds?: Partial<RewriteThresholds>,
): RewriteDecision;
export async function generateCandidates(
  decision: RewriteDecision,
  analysis: QueryAnalysis,
): Promise<RewriteCandidate[]>;
export async function analyzeAndRewrite(
  query: string,
  category: QueryCategory,
  firstPassResults: ScoredChunk[],
  scoreSource?: ScoreSource,
  thresholds?: Partial<RewriteThresholds>,
): Promise<RewriteResult>;
export const DEFAULT_THRESHOLDS: RewriteThresholds;
```

### merge.ts

```typescript
export function mergeResults(
  firstPass: ScoredChunk[],
  rewritePasses: ScoredChunk[][],
  candidates: RewriteCandidate[],
  consensusBonus?: number,
): MergedChunk[];
export function toScoredChunks(merged: MergedChunk[]): ScoredChunk[];
export function buildDiagnosticSnapshots(
  firstPass: ScoredChunk[],
  finalChunks: ScoredChunk[],
  topK: number,
): { before: RetrievalSnapshot; after: RetrievalComparison };
```

### llm/index.ts (addition)

```typescript
export async function rewriteQueries(
  query: string,
  anchors: QueryAnchors,
  count?: number,
): Promise<string[]>;
```

---

## Structured Logging

Single JSON log line per request, using the existing `requestId` for correlation with `logStreamMetrics`:

```typescript
{
  type: 'rewrite_diagnostics',
  requestId, repo, mode, reasonCodes, rewriteScore,
  riskScore, confidenceScore,
  anchorTypes: ['filePaths', ...],
  candidateCount,
  overlap: afterRewrite?.overlapRatio,
  newChunks: afterRewrite?.newChunkIds.length,
  timing: { ... },
  counts: { ... },
}
```

---

## What is NOT changed

- `router.ts` — query classification stays as-is
- `hybrid.ts` — single-query retrieval, unchanged (note: internally calls `rerank`, so results are rerank-boosted; this means a second rerank pass happens on the merged set — see Architecture section)
- `vector.ts`, `keyword.ts` — search implementations unchanged
- `rerank.ts` — heuristic reranker unchanged
- Frontend code — no changes
- SSE streaming contract — no changes
- Citation behavior — preserved (sources built from final reranked chunks)

---

## Trade-offs

| Decision | Trade-off |
|----------|-----------|
| Deterministic-first | Lower quality ceiling for ambiguous queries, but predictable, fast, and debuggable |
| Max-wins merge | Could miss cumulative weak signals, but avoids rewrite-volume inflation |
| Rerank against original only | Rewrite-specific relevance not captured in final ranking, but preserves user intent |
| Rebuild MiniSearch per candidate query | Extra CPU per rewrite candidate, but keeps keyword.ts stateless and serverless-friendly |
| Single LLM call for strong-llm | Limited to one round of expansion, but keeps latency bounded |
| No fuzzy dedup | Could miss near-duplicate chunks with different IDs, but chunk IDs are deterministic |
| Double rerank (per-query + final) | Absolute scores shift slightly from additive boosts applied twice, but keeps `hybrid.ts` unchanged and relative ordering is stable; can extract `hybridSearchRaw()` later if needed |
| `generateCandidates` is async | Adds a microtask tick even for deterministic modes, but required for `strong-llm` LLM call; deterministic paths resolve synchronously within the Promise |
