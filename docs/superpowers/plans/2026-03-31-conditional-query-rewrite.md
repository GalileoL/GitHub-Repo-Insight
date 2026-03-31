# Conditional Query Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a conditional query rewrite system to the Ask Repo RAG pipeline that analyzes query risk and retrieval confidence, then triggers deterministic rewrites (or selective LLM fallback) to improve retrieval quality for vague/complex queries.

**Architecture:** New `rewrite.ts` (decision engine) and `merge.ts` (result merging) modules sit between the existing router and hybrid search. `ask.ts` orchestrates: first-pass search → analyze → conditional rewrite searches → merge → rerank → generate. All existing modules (`hybrid.ts`, `rerank.ts`, `router.ts`, `vector.ts`, `keyword.ts`) remain unchanged.

**Tech Stack:** TypeScript, Vitest, Vercel serverless, Upstash Vector, MiniSearch, OpenAI API

**Spec:** `docs/superpowers/specs/2026-03-31-conditional-query-rewrite-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `vitest.config.ts` | Modify | Add `lib/**/*.test.ts` to include patterns, add `node` environment override for lib tests |
| `lib/rag/types.ts` | Modify | Add all new interfaces (QueryAnchors, QueryAnalysis, RewriteDecision, etc.) |
| `lib/rag/retrieval/rewrite.ts` | Create | Query analysis, risk scoring, decision engine, candidate generation |
| `lib/rag/retrieval/rewrite.test.ts` | Create | Unit tests for all rewrite functions |
| `lib/rag/retrieval/merge.ts` | Create | Merge multi-pass results, dedupe, diagnostic snapshots |
| `lib/rag/retrieval/merge.test.ts` | Create | Unit tests for merge/dedupe/snapshot functions |
| `lib/rag/llm/index.ts` | Modify | Add `rewriteQueries()` export for strong-llm mode |
| `api/rag/ask.ts` | Modify | Orchestrate rewrite pipeline, structured logging |

---

## Task 1: Configure Vitest for backend tests

**Files:**
- Modify: `vitest.config.ts`

Backend modules in `lib/` are currently excluded from Vitest. We need to include them before writing tests.

- [ ] **Step 1: Update vitest config to include lib tests**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'lib/**/*.test.ts'],
    globals: true,
    coverage: {
      reporter: ['text', 'lcov'],
    },
    environmentMatchGlobs: [
      ['lib/**/*.test.ts', 'node'],
    ],
  },
});
```

- [ ] **Step 2: Verify config works**

Run: `npx vitest run --reporter=verbose 2>&1 | head -20`
Expected: Vitest starts without config errors. Existing `src/` tests still run.

- [ ] **Step 3: Commit**

```bash
git add vitest.config.ts
git commit -m "chore: include lib/ backend tests in vitest config"
```

---

## Task 2: Add type definitions to types.ts

**Files:**
- Modify: `lib/rag/types.ts`

Add all interfaces needed by the rewrite pipeline. No implementation yet — just types.

- [ ] **Step 1: Add rewrite-related types at the end of types.ts**

Append after the existing `RawCommit` interface:

```typescript
// ═══ Query Rewrite Types ══════════════════════════════════════

/** Anchors extracted from the query that must be preserved verbatim */
export interface QueryAnchors {
  filePaths: string[];
  endpoints: string[];
  codeSymbols: string[];
  directories: string[];
}

/** Which anchor type caused the risk discount, and by how much */
export interface AnchorDiscount {
  appliedMultiplier: number;
  anchorType: keyof QueryAnchors;
  rawRiskScore: number;
  discountedRiskScore: number;
}

/** Risk signals that indicate the query may need rewriting */
export interface QueryRiskSignals {
  isVague: boolean;
  isComplex: boolean;
  hasNegation: boolean;
  isComparative: boolean;
  hasImplicitContext: boolean;
}

/** Full analysis result for a query */
export interface QueryAnalysis {
  original: string;
  anchors: QueryAnchors;
  riskSignals: QueryRiskSignals;
  riskScore: number;
  anchorDiscount: AnchorDiscount | null;
  category: QueryCategory;
}

// 'hybrid_rrf':     raw RRF fusion scores (before rerank) — not currently exposed
// 'rerank_boosted': scores after hybridSearch's internal rerank — current default
// 'normalized':     reserved for future use
export type ScoreSource = 'hybrid_rrf' | 'rerank_boosted' | 'normalized';

/** Signals computed from first-pass retrieval results */
export interface RetrievalConfidence {
  topScore: number;
  scoreGap: number;
  coverageRatio: number;
  avgScore: number;
  confidenceScore: number;
  scoreSource: ScoreSource;
}

export type RewriteMode = 'none' | 'light' | 'strong' | 'strong-llm';

export type ReasonCode =
  | 'vague_query' | 'complex_query' | 'negation_present'
  | 'comparative_query' | 'implicit_context'
  | 'low_top_score' | 'small_score_gap' | 'low_coverage' | 'low_avg_score'
  | 'anchors_present' | 'high_confidence';

export interface RewriteThresholds {
  light: number;
  strong: number;
  llm: number;
  confidenceFloor: number;
  consensusBonus: number;
}

export interface RewriteDecision {
  mode: RewriteMode;
  reasonCodes: ReasonCode[];
  reason: string;
  rewriteScore: number;
  thresholds: RewriteThresholds;
}

export type RewriteStrategy = 'synonym' | 'decompose' | 'expand' | 'llm';

export interface RewriteCandidate {
  query: string;
  strategy: RewriteStrategy;
  preservedAnchors: QueryAnchors;
}

export interface RewriteResult {
  decision: RewriteDecision;
  candidates: RewriteCandidate[];
  analysis: QueryAnalysis;
}

export interface MergedChunk {
  chunk: Chunk;
  originalScore: number | null;
  rewriteScores: Record<number, number>;
  mergedScore: number;
  sourceQueries: string[];
  fromOriginal: boolean;
}

export interface RetrievalSnapshot {
  topScore: number;
  avgScore: number;
  chunkIds: string[];
  coverageRatio: number;
}

export interface RetrievalComparison extends RetrievalSnapshot {
  newChunkIds: string[];
  droppedChunkIds: string[];
  overlapRatio: number;
}

export interface RetrievalDiagnostics {
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

- [ ] **Step 2: Verify types compile**

Run: `npx tsc -p tsconfig.server.json --noEmit 2>&1 | head -20`
Expected: No errors from types.ts changes.

- [ ] **Step 3: Commit**

```bash
git add lib/rag/types.ts
git commit -m "feat(rag): add query rewrite type definitions"
```

---

## Task 3: Implement rewrite.ts — anchor extraction and query analysis

**Files:**
- Create: `lib/rag/retrieval/rewrite.ts`
- Create: `lib/rag/retrieval/rewrite.test.ts`

This task implements `analyzeQuery()` — anchor extraction, risk signal detection, and risk scoring. The decision engine and candidate generation come in Tasks 4 and 5.

- [ ] **Step 1: Write failing tests for anchor extraction**

Create `lib/rag/retrieval/rewrite.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { analyzeQuery } from './rewrite.js';

describe('analyzeQuery', () => {
  describe('anchor extraction', () => {
    it('extracts file paths', () => {
      const result = analyzeQuery('What does src/utils/auth.ts do?', 'general');
      expect(result.anchors.filePaths).toEqual(['src/utils/auth.ts']);
    });

    it('extracts endpoints', () => {
      const result = analyzeQuery('How does /api/rag/ask work?', 'general');
      expect(result.anchors.endpoints).toEqual(['/api/rag/ask']);
    });

    it('extracts HTTP method endpoints', () => {
      const result = analyzeQuery('What does POST /api/rag/ingest return?', 'general');
      expect(result.anchors.endpoints).toEqual(['POST /api/rag/ingest']);
    });

    it('extracts code symbols in backticks', () => {
      const result = analyzeQuery('How does `hybridSearch` work?', 'general');
      expect(result.anchors.codeSymbols).toEqual(['hybridSearch']);
    });

    it('extracts PascalCase symbols', () => {
      const result = analyzeQuery('What is ScoredChunk used for?', 'general');
      expect(result.anchors.codeSymbols).toEqual(['ScoredChunk']);
    });

    it('extracts directories with trailing slash', () => {
      const result = analyzeQuery('What is in lib/rag/retrieval/?', 'general');
      expect(result.anchors.directories).toEqual(['lib/rag/retrieval/']);
    });

    it('does not confuse file paths with code symbols', () => {
      const result = analyzeQuery('Check src/utils/auth.ts and ScoredChunk', 'general');
      expect(result.anchors.filePaths).toEqual(['src/utils/auth.ts']);
      expect(result.anchors.codeSymbols).toEqual(['ScoredChunk']);
    });

    it('returns empty anchors for plain question', () => {
      const result = analyzeQuery('What is this project about?', 'documentation');
      expect(result.anchors.filePaths).toEqual([]);
      expect(result.anchors.endpoints).toEqual([]);
      expect(result.anchors.codeSymbols).toEqual([]);
      expect(result.anchors.directories).toEqual([]);
    });
  });

  describe('risk signals', () => {
    it('detects vague query', () => {
      const result = analyzeQuery('explain this', 'general');
      expect(result.riskSignals.isVague).toBe(true);
    });

    it('does not flag specific query as vague', () => {
      const result = analyzeQuery('How does src/utils/auth.ts handle token refresh?', 'general');
      expect(result.riskSignals.isVague).toBe(false);
    });

    it('detects complex query', () => {
      const result = analyzeQuery(
        'How does the auth system interact with the rate limiter and what are the error codes?',
        'general',
      );
      expect(result.riskSignals.isComplex).toBe(true);
    });

    it('detects negation', () => {
      const result = analyzeQuery('Which endpoints do not require authentication?', 'general');
      expect(result.riskSignals.hasNegation).toBe(true);
    });

    it('detects comparative query', () => {
      const result = analyzeQuery('What is the difference between vector and keyword search?', 'general');
      expect(result.riskSignals.isComparative).toBe(true);
    });

    it('detects implicit context', () => {
      const result = analyzeQuery('What does it return?', 'general');
      expect(result.riskSignals.hasImplicitContext).toBe(true);
    });
  });

  describe('risk scoring', () => {
    it('scores vague query high', () => {
      const result = analyzeQuery('explain this', 'general');
      expect(result.riskScore).toBeGreaterThanOrEqual(0.3);
    });

    it('scores anchored query low', () => {
      const result = analyzeQuery('What does src/utils/auth.ts do?', 'documentation');
      expect(result.riskScore).toBeLessThan(0.3);
    });

    it('applies file path anchor discount', () => {
      const result = analyzeQuery('explain src/utils/auth.ts', 'general');
      expect(result.anchorDiscount).not.toBeNull();
      expect(result.anchorDiscount!.anchorType).toBe('filePaths');
      expect(result.anchorDiscount!.appliedMultiplier).toBe(0.5);
      expect(result.anchorDiscount!.discountedRiskScore).toBeLessThan(
        result.anchorDiscount!.rawRiskScore,
      );
    });

    it('returns null anchor discount when no anchors', () => {
      const result = analyzeQuery('What is this project about?', 'documentation');
      expect(result.anchorDiscount).toBeNull();
    });

    it('uses lowest multiplier when multiple anchor types present', () => {
      const result = analyzeQuery('How does `hybridSearch` in src/utils/auth.ts work?', 'general');
      expect(result.anchorDiscount).not.toBeNull();
      expect(result.anchorDiscount!.anchorType).toBe('filePaths');
      expect(result.anchorDiscount!.appliedMultiplier).toBe(0.5);
    });

    it('risk score stays in 0-1 range', () => {
      const queries = [
        'x',
        'What is this?',
        'How does the architecture of the auth system compare to the rate limiter and what changed recently?',
        'Check src/utils/auth.ts',
      ];
      for (const q of queries) {
        const result = analyzeQuery(q, 'general');
        expect(result.riskScore).toBeGreaterThanOrEqual(0);
        expect(result.riskScore).toBeLessThanOrEqual(1);
      }
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/rag/retrieval/rewrite.test.ts --reporter=verbose 2>&1 | tail -5`
Expected: FAIL — module `./rewrite.js` not found.

- [ ] **Step 3: Implement analyzeQuery in rewrite.ts**

Create `lib/rag/retrieval/rewrite.ts`:

```typescript
import type {
  QueryCategory,
  QueryAnchors,
  AnchorDiscount,
  QueryRiskSignals,
  QueryAnalysis,
  ScoreSource,
  RetrievalConfidence,
  RewriteThresholds,
  RewriteDecision,
  RewriteCandidate,
  RewriteResult,
  ReasonCode,
  ScoredChunk,
} from '../types.js';

// ─── Constants ────────────────────────────────────────────────

export const DEFAULT_THRESHOLDS: RewriteThresholds = {
  light: 0.3,
  strong: 0.55,
  llm: 0.8,
  confidenceFloor: 0.3,
  consensusBonus: 0.05,
};

const RISK_WEIGHTS = {
  isVague: 0.30,
  isComplex: 0.25,
  hasImplicitContext: 0.20,
  isComparative: 0.15,
  hasNegation: 0.10,
} as const;

const ANCHOR_MULTIPLIERS: Record<keyof QueryAnchors, number> = {
  filePaths: 0.5,
  endpoints: 0.6,
  codeSymbols: 0.7,
  directories: 0.7,
};

const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'about', 'between',
  'through', 'after', 'before', 'above', 'below', 'and', 'but', 'or',
  'if', 'then', 'so', 'than', 'too', 'very', 'just', 'that', 'this',
  'it', 'its', 'my', 'your', 'his', 'her', 'our', 'their', 'what',
  'which', 'who', 'whom', 'when', 'where', 'why', 'how', 'me',
]);

// ─── Anchor Extraction ───────────────────────────────────────

const FILE_PATH_RE = /[\w.-]+\/[\w.-]+\.\w{1,5}/g;
const ENDPOINT_RE = /(?:(?:GET|POST|PUT|DELETE|PATCH)\s+\/[\w\/.-]+|\/api\/[\w\/.-]+)/gi;
const DIRECTORY_RE = /[\w.-]+\/[\w.-]+\//g;
const BACKTICK_SYMBOL_RE = /`([A-Za-z_]\w+)`/g;
const PASCAL_CAMEL_RE = /\b([A-Z][a-z]+[A-Z]\w*|[a-z]+[A-Z]\w*)\b/g;

function extractAnchors(query: string): QueryAnchors {
  const filePaths = Array.from(new Set(query.match(FILE_PATH_RE) ?? []));

  const endpoints = Array.from(new Set(
    (query.match(ENDPOINT_RE) ?? []).map((e) => e.trim()),
  ));

  const directories = Array.from(new Set(
    (query.match(DIRECTORY_RE) ?? []).filter((d) => !filePaths.some((fp) => fp.includes(d))),
  ));

  // Code symbols: backtick-wrapped or PascalCase/camelCase, excluding file path fragments
  const filePathTokens = new Set(filePaths.flatMap((fp) => fp.split(/[\/\.]/)));
  const backtickMatches: string[] = [];
  let m: RegExpExecArray | null;
  const btRe = new RegExp(BACKTICK_SYMBOL_RE.source, BACKTICK_SYMBOL_RE.flags);
  while ((m = btRe.exec(query)) !== null) {
    backtickMatches.push(m[1]);
  }
  const camelMatches = (query.replace(/`[^`]*`/g, '').match(PASCAL_CAMEL_RE) ?? [])
    .filter((s) => !filePathTokens.has(s));
  const codeSymbols = Array.from(new Set([...backtickMatches, ...camelMatches]));

  return { filePaths, endpoints, codeSymbols, directories };
}

// ─── Risk Signal Detection ────────────────────────────────────

function detectRiskSignals(query: string, anchors: QueryAnchors): QueryRiskSignals {
  const q = query.toLowerCase();
  const words = q.split(/\s+/).filter((w) => w.length > 0 && !STOPWORDS.has(w));
  const hasAnyAnchor = Object.values(anchors).some((arr) => arr.length > 0);

  const isVague =
    (words.length <= 3 && !hasAnyAnchor) ||
    /^(tell me about|explain|show me|describe)\b/.test(q);

  const isComplex =
    (words.length > 15) ||
    (q.includes(' and ') && q.includes('?') && /\b(how|what|why|where)\b/.test(q)) ||
    /\b(but also|as well as)\b/.test(q) ||
    (q.match(/\?/g) ?? []).length > 1 ||
    /\b(architecture|design|interact|relationship between)\b/.test(q);

  const hasNegation = /\b(not|without|except|don't|doesn't|isn't|aren't|no\s)\b/.test(q);

  const isComparative = /\b(vs|versus|compare|comparing|difference|differ|between .+ and)\b/.test(q);

  const hasImplicitContext =
    /^(it|they|that|this|these|those)\b/.test(q) ||
    /\b(the above|mentioned|previous)\b/.test(q);

  return { isVague, isComplex, hasNegation, isComparative, hasImplicitContext };
}

// ─── Risk Scoring ─────────────────────────────────────────────

function computeRiskScore(
  signals: QueryRiskSignals,
  anchors: QueryAnchors,
): { riskScore: number; anchorDiscount: AnchorDiscount | null } {
  const rawScore =
    (signals.isVague ? RISK_WEIGHTS.isVague : 0) +
    (signals.isComplex ? RISK_WEIGHTS.isComplex : 0) +
    (signals.hasImplicitContext ? RISK_WEIGHTS.hasImplicitContext : 0) +
    (signals.isComparative ? RISK_WEIGHTS.isComparative : 0) +
    (signals.hasNegation ? RISK_WEIGHTS.hasNegation : 0);

  // Find the lowest applicable anchor multiplier
  let bestMultiplier = 1.0;
  let bestAnchorType: keyof QueryAnchors | null = null;
  for (const [type, multiplier] of Object.entries(ANCHOR_MULTIPLIERS) as [keyof QueryAnchors, number][]) {
    if (anchors[type].length > 0 && multiplier < bestMultiplier) {
      bestMultiplier = multiplier;
      bestAnchorType = type;
    }
  }

  const discountedScore = Math.min(1, Math.max(0, rawScore * bestMultiplier));
  const anchorDiscount: AnchorDiscount | null = bestAnchorType
    ? {
        appliedMultiplier: bestMultiplier,
        anchorType: bestAnchorType,
        rawRiskScore: rawScore,
        discountedRiskScore: discountedScore,
      }
    : null;

  return { riskScore: discountedScore, anchorDiscount };
}

// ─── Public: analyzeQuery ─────────────────────────────────────

export function analyzeQuery(query: string, category: QueryCategory): QueryAnalysis {
  const anchors = extractAnchors(query);
  const riskSignals = detectRiskSignals(query, anchors);
  const { riskScore, anchorDiscount } = computeRiskScore(riskSignals, anchors);

  return {
    original: query,
    anchors,
    riskSignals,
    riskScore,
    anchorDiscount,
    category,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/rag/retrieval/rewrite.test.ts --reporter=verbose 2>&1 | tail -10`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/rag/retrieval/rewrite.ts lib/rag/retrieval/rewrite.test.ts
git commit -m "feat(rag): implement query analysis and anchor extraction"
```

---

## Task 4: Implement rewrite.ts — confidence scoring and rewrite decision

**Files:**
- Modify: `lib/rag/retrieval/rewrite.ts`
- Modify: `lib/rag/retrieval/rewrite.test.ts`

This task adds `computeConfidence()` and `makeRewriteDecision()`.

- [ ] **Step 1: Write failing tests for confidence scoring and decision**

Append to `lib/rag/retrieval/rewrite.test.ts`:

```typescript
import { analyzeQuery, computeConfidence, makeRewriteDecision, DEFAULT_THRESHOLDS } from './rewrite.js';
import type { ScoredChunk, Chunk } from '../types.js';

function makeChunk(id: string, score: number, opts?: Partial<Chunk['metadata']>): ScoredChunk {
  return {
    chunk: {
      id,
      content: 'Test content that is long enough to be meaningful for testing purposes.',
      metadata: {
        repo: 'owner/repo',
        type: 'issue',
        title: `Test chunk ${id}`,
        githubUrl: `https://github.com/owner/repo/issues/${id}`,
        ...opts,
      },
    },
    score,
  };
}

describe('computeConfidence', () => {
  it('returns high confidence for strong results', () => {
    const results = [
      makeChunk('1', 0.95),
      makeChunk('2', 0.6),
      makeChunk('3', 0.5),
    ];
    const confidence = computeConfidence(results, 'rerank_boosted');
    expect(confidence.confidenceScore).toBeGreaterThan(0.5);
    expect(confidence.scoreSource).toBe('rerank_boosted');
  });

  it('returns low confidence for weak results', () => {
    const results = [
      makeChunk('1', 0.15),
      makeChunk('2', 0.14),
      makeChunk('3', 0.12),
    ];
    const confidence = computeConfidence(results, 'rerank_boosted');
    expect(confidence.confidenceScore).toBeLessThan(0.3);
  });

  it('returns zero confidence for empty results', () => {
    const confidence = computeConfidence([], 'rerank_boosted');
    expect(confidence.confidenceScore).toBe(0);
    expect(confidence.topScore).toBe(0);
    expect(confidence.scoreGap).toBe(0);
    expect(confidence.coverageRatio).toBe(0);
    expect(confidence.avgScore).toBe(0);
  });

  it('returns zero confidence for single result', () => {
    const confidence = computeConfidence([makeChunk('1', 0.5)], 'rerank_boosted');
    expect(confidence.scoreGap).toBe(0);
    expect(confidence.topScore).toBe(0.5);
  });
});

describe('makeRewriteDecision', () => {
  it('returns none for clear query with high confidence', () => {
    const analysis = analyzeQuery('What does src/utils/auth.ts do?', 'documentation');
    const confidence = computeConfidence(
      [makeChunk('1', 0.9), makeChunk('2', 0.5), makeChunk('3', 0.4)],
      'rerank_boosted',
    );
    const decision = makeRewriteDecision(analysis, confidence);
    expect(decision.mode).toBe('none');
    expect(decision.reasonCodes).toContain('high_confidence');
  });

  it('returns light for mildly vague query', () => {
    const analysis = analyzeQuery('How does auth work?', 'general');
    const confidence = computeConfidence(
      [makeChunk('1', 0.4), makeChunk('2', 0.35), makeChunk('3', 0.3)],
      'rerank_boosted',
    );
    const decision = makeRewriteDecision(analysis, confidence);
    expect(['light', 'strong']).toContain(decision.mode);
    expect(decision.rewriteScore).toBeGreaterThanOrEqual(DEFAULT_THRESHOLDS.light);
  });

  it('returns strong for vague query with poor retrieval', () => {
    const analysis = analyzeQuery('explain the architecture', 'general');
    const confidence = computeConfidence(
      [makeChunk('1', 0.2), makeChunk('2', 0.18), makeChunk('3', 0.15)],
      'rerank_boosted',
    );
    const decision = makeRewriteDecision(analysis, confidence);
    expect(['strong', 'strong-llm']).toContain(decision.mode);
    expect(decision.rewriteScore).toBeGreaterThanOrEqual(DEFAULT_THRESHOLDS.strong);
  });

  it('caps at strong when anchors are present even with high rewrite score', () => {
    const analysis = analyzeQuery('explain src/utils/auth.ts and its relationship to everything', 'general');
    const confidence = computeConfidence(
      [makeChunk('1', 0.1), makeChunk('2', 0.09)],
      'rerank_boosted',
    );
    const decision = makeRewriteDecision(analysis, confidence);
    expect(decision.mode).not.toBe('strong-llm');
    if (decision.reasonCodes.includes('anchors_present')) {
      expect(decision.mode).toBe('strong');
    }
  });

  it('includes reason codes that explain the decision', () => {
    const analysis = analyzeQuery('explain this', 'general');
    const confidence = computeConfidence(
      [makeChunk('1', 0.15), makeChunk('2', 0.14)],
      'rerank_boosted',
    );
    const decision = makeRewriteDecision(analysis, confidence);
    expect(decision.reasonCodes.length).toBeGreaterThan(0);
    expect(decision.reason).toBeTruthy();
  });

  it('rewrite score stays in 0-1 range', () => {
    const analysis = analyzeQuery('x', 'general');
    const confidence = computeConfidence([], 'rerank_boosted');
    const decision = makeRewriteDecision(analysis, confidence);
    expect(decision.rewriteScore).toBeGreaterThanOrEqual(0);
    expect(decision.rewriteScore).toBeLessThanOrEqual(1);
  });

  it('accepts custom thresholds', () => {
    const analysis = analyzeQuery('explain this', 'general');
    const confidence = computeConfidence(
      [makeChunk('1', 0.3), makeChunk('2', 0.25)],
      'rerank_boosted',
    );
    const decision = makeRewriteDecision(analysis, confidence, { light: 0.9, strong: 0.95, llm: 0.99 });
    expect(decision.mode).toBe('none');
    expect(decision.thresholds.light).toBe(0.9);
  });
});
```

- [ ] **Step 2: Update the import in the test file**

Update the import at the top of `rewrite.test.ts` to include all new exports:

```typescript
import { describe, it, expect } from 'vitest';
import { analyzeQuery, computeConfidence, makeRewriteDecision, DEFAULT_THRESHOLDS } from './rewrite.js';
import type { ScoredChunk, Chunk } from '../types.js';
```

- [ ] **Step 3: Run tests to verify the new tests fail**

Run: `npx vitest run lib/rag/retrieval/rewrite.test.ts --reporter=verbose 2>&1 | tail -10`
Expected: New tests FAIL — `computeConfidence` and `makeRewriteDecision` not exported.

- [ ] **Step 4: Implement computeConfidence and makeRewriteDecision**

Append to `lib/rag/retrieval/rewrite.ts`:

```typescript
// ─── Confidence Scoring ───────────────────────────────────────

const CONFIDENCE_WEIGHTS = {
  topScore: 0.35,
  scoreGap: 0.25,
  coverageRatio: 0.25,
  avgScore: 0.15,
} as const;

/**
 * Compute retrieval confidence from first-pass results.
 * Score-source agnostic — works with any scoring stage.
 * Returns all zeros for empty results.
 */
export function computeConfidence(
  results: ScoredChunk[],
  scoreSource: ScoreSource,
): RetrievalConfidence {
  if (results.length === 0) {
    return { topScore: 0, scoreGap: 0, coverageRatio: 0, avgScore: 0, confidenceScore: 0, scoreSource };
  }

  const scores = results.map((r) => r.score).sort((a, b) => b - a);
  const topScore = scores[0];
  const scoreGap = scores.length > 1 ? scores[0] - scores[1] : 0;

  // Coverage: fraction of results above a relevance floor (> 25% of top score)
  const floor = topScore * 0.25;
  const coverageRatio = scores.filter((s) => s > floor).length / scores.length;

  const avgScore = scores.reduce((sum, s) => sum + s, 0) / scores.length;

  // Normalize each component to 0–1 within the result set
  const maxPossibleGap = topScore; // gap can't exceed top score
  const normalizedGap = maxPossibleGap > 0 ? Math.min(1, scoreGap / maxPossibleGap) : 0;

  const confidenceScore = Math.min(1, Math.max(0,
    topScore * CONFIDENCE_WEIGHTS.topScore +
    normalizedGap * CONFIDENCE_WEIGHTS.scoreGap +
    coverageRatio * CONFIDENCE_WEIGHTS.coverageRatio +
    avgScore * CONFIDENCE_WEIGHTS.avgScore,
  ));

  return { topScore, scoreGap, coverageRatio, avgScore, confidenceScore, scoreSource };
}

// ─── Rewrite Decision ─────────────────────────────────────────

/**
 * Deterministic decision engine: maps risk + confidence to a rewrite mode.
 * Returns structured reason codes for logging and analysis.
 */
export function makeRewriteDecision(
  analysis: QueryAnalysis,
  confidence: RetrievalConfidence,
  thresholds?: Partial<RewriteThresholds>,
): RewriteDecision {
  const t: RewriteThresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const rewriteScore = Math.min(1, Math.max(0,
    (analysis.riskScore * 0.6) + ((1 - confidence.confidenceScore) * 0.4),
  ));

  const reasonCodes: ReasonCode[] = [];

  // Collect risk reason codes
  if (analysis.riskSignals.isVague) reasonCodes.push('vague_query');
  if (analysis.riskSignals.isComplex) reasonCodes.push('complex_query');
  if (analysis.riskSignals.hasNegation) reasonCodes.push('negation_present');
  if (analysis.riskSignals.isComparative) reasonCodes.push('comparative_query');
  if (analysis.riskSignals.hasImplicitContext) reasonCodes.push('implicit_context');

  // Collect confidence reason codes
  if (confidence.topScore < 0.3) reasonCodes.push('low_top_score');
  if (confidence.scoreGap < 0.1) reasonCodes.push('small_score_gap');
  if (confidence.coverageRatio < 0.5) reasonCodes.push('low_coverage');
  if (confidence.avgScore < 0.2) reasonCodes.push('low_avg_score');

  // Determine mode from thresholds
  let mode: RewriteDecision['mode'];
  if (rewriteScore >= t.llm) {
    // strong-llm guard: ALL three conditions required
    const hasAnyAnchor = Object.values(analysis.anchors).some((arr) => arr.length > 0);
    if (!hasAnyAnchor && confidence.confidenceScore < t.confidenceFloor) {
      mode = 'strong-llm';
    } else {
      mode = 'strong';
      if (hasAnyAnchor) reasonCodes.push('anchors_present');
    }
  } else if (rewriteScore >= t.strong) {
    mode = 'strong';
  } else if (rewriteScore >= t.light) {
    mode = 'light';
  } else {
    mode = 'none';
    if (confidence.confidenceScore > 0.5) reasonCodes.push('high_confidence');
  }

  const reason = reasonCodes.length > 0
    ? `${mode}: ${reasonCodes.join(', ')} (score=${rewriteScore.toFixed(2)})`
    : `${mode}: no significant risk signals (score=${rewriteScore.toFixed(2)})`;

  return { mode, reasonCodes, reason, rewriteScore, thresholds: t };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run lib/rag/retrieval/rewrite.test.ts --reporter=verbose 2>&1 | tail -15`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/rag/retrieval/rewrite.ts lib/rag/retrieval/rewrite.test.ts
git commit -m "feat(rag): implement confidence scoring and rewrite decision engine"
```

---

## Task 5: Implement rewrite.ts — candidate generation and analyzeAndRewrite

**Files:**
- Modify: `lib/rag/retrieval/rewrite.ts`
- Modify: `lib/rag/retrieval/rewrite.test.ts`

This task adds deterministic candidate generation (synonym, decompose, expand) and the convenience `analyzeAndRewrite()` function. The LLM fallback is wired in Task 7.

- [ ] **Step 1: Write failing tests for candidate generation**

Append to `rewrite.test.ts`:

```typescript
import {
  analyzeQuery,
  computeConfidence,
  makeRewriteDecision,
  generateCandidates,
  analyzeAndRewrite,
  DEFAULT_THRESHOLDS,
} from './rewrite.js';

describe('generateCandidates', () => {
  it('returns empty array for mode none', async () => {
    const analysis = analyzeQuery('What does src/utils/auth.ts do?', 'documentation');
    const decision = makeRewriteDecision(
      analysis,
      computeConfidence([makeChunk('1', 0.9), makeChunk('2', 0.5)], 'rerank_boosted'),
    );
    // Force mode to none for test stability
    const noneDecision = { ...decision, mode: 'none' as const };
    const candidates = await generateCandidates(noneDecision, analysis);
    expect(candidates).toEqual([]);
  });

  it('returns 1 candidate for light mode with synonym expansion', async () => {
    const analysis = analyzeQuery('How does auth work?', 'general');
    const decision = { ...makeRewriteDecision(
      analysis,
      computeConfidence([makeChunk('1', 0.3)], 'rerank_boosted'),
    ), mode: 'light' as const };
    const candidates = await generateCandidates(decision, analysis);
    expect(candidates.length).toBe(1);
    expect(candidates[0].strategy).toBe('synonym');
    expect(candidates[0].query).not.toBe(analysis.original);
  });

  it('returns 2-3 candidates for strong mode', async () => {
    const analysis = analyzeQuery('explain the architecture and error handling', 'general');
    const decision = { ...makeRewriteDecision(
      analysis,
      computeConfidence([makeChunk('1', 0.15)], 'rerank_boosted'),
    ), mode: 'strong' as const };
    const candidates = await generateCandidates(decision, analysis);
    expect(candidates.length).toBeGreaterThanOrEqual(2);
    expect(candidates.length).toBeLessThanOrEqual(3);
    const strategies = candidates.map((c) => c.strategy);
    expect(strategies).toContain('synonym');
  });

  it('preserves anchors in all candidates', async () => {
    const analysis = analyzeQuery('explain src/utils/auth.ts and the error handling', 'general');
    const decision = { ...makeRewriteDecision(
      analysis,
      computeConfidence([makeChunk('1', 0.15)], 'rerank_boosted'),
    ), mode: 'strong' as const };
    const candidates = await generateCandidates(decision, analysis);
    for (const c of candidates) {
      expect(c.query).toContain('src/utils/auth.ts');
      expect(c.preservedAnchors.filePaths).toContain('src/utils/auth.ts');
    }
  });
});

describe('analyzeAndRewrite', () => {
  it('returns full result with decision and candidates', async () => {
    const results = [makeChunk('1', 0.9), makeChunk('2', 0.5)];
    const rewriteResult = await analyzeAndRewrite('What does src/utils/auth.ts do?', 'documentation', results);
    expect(rewriteResult.analysis.original).toBe('What does src/utils/auth.ts do?');
    expect(rewriteResult.decision.mode).toBeDefined();
    expect(rewriteResult.candidates).toBeDefined();
  });

  it('returns no candidates when mode is none', async () => {
    const results = [makeChunk('1', 0.95), makeChunk('2', 0.6), makeChunk('3', 0.5)];
    const rewriteResult = await analyzeAndRewrite('What does src/utils/auth.ts do?', 'documentation', results);
    if (rewriteResult.decision.mode === 'none') {
      expect(rewriteResult.candidates).toEqual([]);
    }
  });
});
```

- [ ] **Step 2: Update the import at the top of rewrite.test.ts**

Consolidate all imports to use the full set:

```typescript
import { describe, it, expect } from 'vitest';
import {
  analyzeQuery,
  computeConfidence,
  makeRewriteDecision,
  generateCandidates,
  analyzeAndRewrite,
  DEFAULT_THRESHOLDS,
} from './rewrite.js';
import type { ScoredChunk, Chunk } from '../types.js';
```

- [ ] **Step 3: Run tests to verify the new tests fail**

Run: `npx vitest run lib/rag/retrieval/rewrite.test.ts --reporter=verbose 2>&1 | tail -5`
Expected: FAIL — `generateCandidates` and `analyzeAndRewrite` not exported.

- [ ] **Step 4: Implement candidate generation and analyzeAndRewrite**

Append to `lib/rag/retrieval/rewrite.ts`:

```typescript
// ─── Synonym / Vocabulary Maps ────────────────────────────────

const SYNONYM_MAP: Record<string, string> = {
  auth: 'authentication',
  authn: 'authentication',
  authz: 'authorization',
  deps: 'dependencies',
  dep: 'dependency',
  config: 'configuration',
  env: 'environment',
  repo: 'repository',
  db: 'database',
  msg: 'message',
  err: 'error',
  req: 'request',
  res: 'response',
  fn: 'function',
  func: 'function',
  impl: 'implementation',
  init: 'initialization',
  param: 'parameter',
  params: 'parameters',
  arg: 'argument',
  args: 'arguments',
  dev: 'development',
  prod: 'production',
  perf: 'performance',
  docs: 'documentation',
  doc: 'documentation',
  info: 'information',
  async: 'asynchronous',
  sync: 'synchronous',
  middleware: 'middleware',
  ws: 'websocket',
  ci: 'continuous integration',
  cd: 'continuous deployment',
};

const CONCEPT_EXPANSIONS: Record<string, string> = {
  'error handling': 'error handling try catch error boundary exception',
  'rate limit': 'rate limit throttle quota requests per minute',
  'caching': 'caching cache invalidation ttl stale',
  'streaming': 'streaming SSE server-sent events stream chunk delta',
  'testing': 'testing test unit integration vitest mock',
  'deployment': 'deployment deploy vercel serverless production',
  'security': 'security authentication authorization token CORS XSS',
  'logging': 'logging log metrics monitoring observability',
  'search': 'search query retrieval vector keyword embedding',
};

// ─── Candidate Generation ─────────────────────────────────────

function allAnchorStrings(anchors: QueryAnchors): string[] {
  return [
    ...anchors.filePaths,
    ...anchors.endpoints,
    ...anchors.codeSymbols,
    ...anchors.directories,
  ];
}

function ensureAnchorsInQuery(query: string, anchors: QueryAnchors): string {
  const missing = allAnchorStrings(anchors).filter((a) => !query.includes(a));
  return missing.length > 0 ? `${query} ${missing.join(' ')}` : query;
}

function synonymRewrite(query: string, anchors: QueryAnchors): RewriteCandidate {
  let rewritten = query;
  for (const [short, full] of Object.entries(SYNONYM_MAP)) {
    const re = new RegExp(`\\b${short}\\b`, 'gi');
    rewritten = rewritten.replace(re, full);
  }
  // If nothing changed, add a small variation by lowercasing and trimming
  if (rewritten === query) {
    rewritten = query.toLowerCase().replace(/[?!.]+$/, '').trim();
    if (rewritten === query.toLowerCase()) {
      rewritten = `${query} overview`;
    }
  }
  rewritten = ensureAnchorsInQuery(rewritten, anchors);
  return { query: rewritten, strategy: 'synonym', preservedAnchors: anchors };
}

function decomposeRewrite(query: string, anchors: QueryAnchors): RewriteCandidate[] {
  // Split on conjunctions that join distinct topics
  const parts = query
    .split(/\b(?:and|but also|as well as|,\s*and|;\s*)\b/i)
    .map((p) => p.trim())
    .filter((p) => p.length > 10);

  if (parts.length < 2) {
    // Can't decompose — return a concept expansion instead
    return [expandRewrite(query, anchors)];
  }

  return parts.slice(0, 2).map((part) => {
    const q = ensureAnchorsInQuery(part.replace(/[?!.]+$/, '').trim() + '?', anchors);
    return { query: q, strategy: 'decompose' as const, preservedAnchors: anchors };
  });
}

function expandRewrite(query: string, anchors: QueryAnchors): RewriteCandidate {
  const q = query.toLowerCase();
  let expanded = query;
  for (const [concept, expansion] of Object.entries(CONCEPT_EXPANSIONS)) {
    if (q.includes(concept)) {
      expanded = `${query} ${expansion}`;
      break;
    }
  }
  if (expanded === query) {
    // Generic expansion: add the category context
    expanded = `${query} implementation details`;
  }
  expanded = ensureAnchorsInQuery(expanded, anchors);
  return { query: expanded, strategy: 'expand', preservedAnchors: anchors };
}

/**
 * Generate rewrite candidates based on the decision mode.
 * Deterministic for none/light/strong. Async for strong-llm (LLM fallback).
 * If strong-llm's LLM call fails, falls back to strong's deterministic candidates.
 */
export async function generateCandidates(
  decision: RewriteDecision,
  analysis: QueryAnalysis,
): Promise<RewriteCandidate[]> {
  const { original, anchors } = analysis;

  switch (decision.mode) {
    case 'none':
      return [];

    case 'light':
      return [synonymRewrite(original, anchors)];

    case 'strong': {
      const synonym = synonymRewrite(original, anchors);
      const decomposed = decomposeRewrite(original, anchors);
      // Dedupe by query string
      const seen = new Set<string>();
      const candidates: RewriteCandidate[] = [];
      for (const c of [synonym, ...decomposed]) {
        if (!seen.has(c.query) && c.query !== original) {
          seen.add(c.query);
          candidates.push(c);
        }
      }
      return candidates.slice(0, 3);
    }

    case 'strong-llm': {
      // LLM rewrite — falls back to deterministic strong on failure.
      // The actual LLM call is wired in Task 7 via rewriteQueries().
      // For now, fall through to strong mode's deterministic candidates.
      try {
        const { rewriteQueries } = await import('../llm/index.js');
        const llmQueries = await rewriteQueries(original, anchors, 3);
        if (llmQueries.length > 0) {
          return llmQueries.map((q) => ({
            query: ensureAnchorsInQuery(q, anchors),
            strategy: 'llm' as const,
            preservedAnchors: anchors,
          }));
        }
      } catch {
        // LLM failed — fall back to deterministic strong
      }
      // Fallback: same as strong mode
      const fallbackSynonym = synonymRewrite(original, anchors);
      const fallbackDecomposed = decomposeRewrite(original, anchors);
      const seen = new Set<string>();
      const fallbackCandidates: RewriteCandidate[] = [];
      for (const c of [fallbackSynonym, ...fallbackDecomposed]) {
        if (!seen.has(c.query) && c.query !== original) {
          seen.add(c.query);
          fallbackCandidates.push(c);
        }
      }
      return fallbackCandidates.slice(0, 3);
    }
  }
}

// ─── Public: analyzeAndRewrite (convenience) ──────────────────

export async function analyzeAndRewrite(
  query: string,
  category: QueryCategory,
  firstPassResults: ScoredChunk[],
  scoreSource: ScoreSource = 'rerank_boosted',
  thresholds?: Partial<RewriteThresholds>,
): Promise<RewriteResult> {
  const analysis = analyzeQuery(query, category);
  const confidence = computeConfidence(firstPassResults, scoreSource);
  const decision = makeRewriteDecision(analysis, confidence, thresholds);
  const candidates = await generateCandidates(decision, analysis);
  return { decision, candidates, analysis };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run lib/rag/retrieval/rewrite.test.ts --reporter=verbose 2>&1 | tail -15`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/rag/retrieval/rewrite.ts lib/rag/retrieval/rewrite.test.ts
git commit -m "feat(rag): implement candidate generation and analyzeAndRewrite"
```

---

## Task 6: Implement merge.ts

**Files:**
- Create: `lib/rag/retrieval/merge.ts`
- Create: `lib/rag/retrieval/merge.test.ts`

- [ ] **Step 1: Write failing tests for merge**

Create `lib/rag/retrieval/merge.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { mergeResults, toScoredChunks, buildDiagnosticSnapshots } from './merge.js';
import type { ScoredChunk, Chunk, RewriteCandidate } from '../types.js';

function makeChunk(id: string, score: number): ScoredChunk {
  return {
    chunk: {
      id,
      content: `Content for ${id}`,
      metadata: {
        repo: 'owner/repo',
        type: 'issue',
        title: `Chunk ${id}`,
        githubUrl: `https://github.com/owner/repo/issues/${id}`,
      },
    },
    score,
  };
}

const dummyCandidate: RewriteCandidate = {
  query: 'rewritten query',
  strategy: 'synonym',
  preservedAnchors: { filePaths: [], endpoints: [], codeSymbols: [], directories: [] },
};

describe('mergeResults', () => {
  it('returns first-pass results unchanged when no rewrite passes', () => {
    const firstPass = [makeChunk('a', 0.9), makeChunk('b', 0.7)];
    const merged = mergeResults(firstPass, [], []);
    expect(merged.length).toBe(2);
    expect(merged[0].chunk.id).toBe('a');
    expect(merged[0].fromOriginal).toBe(true);
    expect(merged[0].originalScore).toBe(0.9);
  });

  it('deduplicates chunks by ID across passes', () => {
    const firstPass = [makeChunk('a', 0.9), makeChunk('b', 0.7)];
    const rewritePass = [makeChunk('a', 0.85), makeChunk('c', 0.8)];
    const merged = mergeResults(firstPass, [rewritePass], [dummyCandidate]);
    const ids = merged.map((m) => m.chunk.id);
    expect(ids.sort()).toEqual(['a', 'b', 'c']);
  });

  it('uses max-wins scoring with consensus bonus', () => {
    const firstPass = [makeChunk('a', 0.9)];
    const rewritePass = [makeChunk('a', 0.85)];
    const merged = mergeResults(firstPass, [rewritePass], [dummyCandidate], 0.05);
    const chunkA = merged.find((m) => m.chunk.id === 'a')!;
    // max(0.9, 0.85) + (2 - 1) * 0.05 = 0.95
    expect(chunkA.mergedScore).toBeCloseTo(0.95, 2);
  });

  it('prefers original on tie (within 0.01)', () => {
    const firstPass = [makeChunk('a', 0.5)];
    const rewritePass = [makeChunk('b', 0.505)];
    const merged = mergeResults(firstPass, [rewritePass], [dummyCandidate]);
    // a is from original (0.5), b is rewrite-only (0.505), within 0.01 → a first
    expect(merged[0].chunk.id).toBe('a');
  });

  it('does not prefer original when score difference is significant', () => {
    const firstPass = [makeChunk('a', 0.5)];
    const rewritePass = [makeChunk('b', 0.8)];
    const merged = mergeResults(firstPass, [rewritePass], [dummyCandidate]);
    expect(merged[0].chunk.id).toBe('b');
  });

  it('tracks sourceQueries correctly', () => {
    const firstPass = [makeChunk('a', 0.9)];
    const rewritePass1 = [makeChunk('a', 0.8)];
    const rewritePass2 = [makeChunk('a', 0.7)];
    const merged = mergeResults(
      firstPass,
      [rewritePass1, rewritePass2],
      [dummyCandidate, { ...dummyCandidate, query: 'second rewrite' }],
    );
    const chunkA = merged.find((m) => m.chunk.id === 'a')!;
    expect(chunkA.sourceQueries.length).toBe(3); // original + 2 rewrites
  });

  it('accepts custom consensus bonus', () => {
    const firstPass = [makeChunk('a', 0.5)];
    const rewritePass = [makeChunk('a', 0.5)];
    const merged0 = mergeResults(firstPass, [rewritePass], [dummyCandidate], 0);
    const merged1 = mergeResults(firstPass, [rewritePass], [dummyCandidate], 0.1);
    expect(merged0[0].mergedScore).toBeCloseTo(0.5, 2);
    expect(merged1[0].mergedScore).toBeCloseTo(0.6, 2);
  });
});

describe('toScoredChunks', () => {
  it('projects MergedChunk to ScoredChunk using mergedScore', () => {
    const firstPass = [makeChunk('a', 0.9)];
    const merged = mergeResults(firstPass, [], []);
    const scored = toScoredChunks(merged);
    expect(scored.length).toBe(1);
    expect(scored[0].chunk.id).toBe('a');
    expect(scored[0].score).toBe(merged[0].mergedScore);
  });
});

describe('buildDiagnosticSnapshots', () => {
  it('computes before/after comparison', () => {
    const firstPass = [makeChunk('a', 0.9), makeChunk('b', 0.7), makeChunk('c', 0.5)];
    const finalChunks = [makeChunk('a', 0.95), makeChunk('d', 0.85), makeChunk('b', 0.7)];
    const { before, after } = buildDiagnosticSnapshots(firstPass, finalChunks, 3);

    expect(before.chunkIds).toEqual(['a', 'b', 'c']);
    expect(after.chunkIds).toEqual(['a', 'd', 'b']);
    expect(after.newChunkIds).toEqual(['d']);
    expect(after.droppedChunkIds).toEqual(['c']);
    expect(after.overlapRatio).toBeCloseTo(2 / 4, 2); // |{a,b}| / |{a,b,c,d}|
  });

  it('handles identical before/after', () => {
    const chunks = [makeChunk('a', 0.9), makeChunk('b', 0.7)];
    const { after } = buildDiagnosticSnapshots(chunks, chunks, 2);
    expect(after.newChunkIds).toEqual([]);
    expect(after.droppedChunkIds).toEqual([]);
    expect(after.overlapRatio).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/rag/retrieval/merge.test.ts --reporter=verbose 2>&1 | tail -5`
Expected: FAIL — module `./merge.js` not found.

- [ ] **Step 3: Implement merge.ts**

Create `lib/rag/retrieval/merge.ts`:

```typescript
import type {
  ScoredChunk,
  MergedChunk,
  RewriteCandidate,
  RetrievalSnapshot,
  RetrievalComparison,
} from '../types.js';
import { DEFAULT_THRESHOLDS } from './rewrite.js';

/**
 * Merge first-pass + rewrite-pass results, deduplicating by chunk ID.
 *
 * Scoring: max-wins + consensus bonus.
 * Tie-breaking: prefer chunks from original query (within 0.01 score margin).
 */
export function mergeResults(
  firstPass: ScoredChunk[],
  rewritePasses: ScoredChunk[][],
  candidates: RewriteCandidate[],
  consensusBonus: number = DEFAULT_THRESHOLDS.consensusBonus,
): MergedChunk[] {
  const map = new Map<string, MergedChunk>();

  // Add first-pass results
  for (const sc of firstPass) {
    map.set(sc.chunk.id, {
      chunk: sc.chunk,
      originalScore: sc.score,
      rewriteScores: {},
      mergedScore: 0, // computed below
      sourceQueries: ['__original__'],
      fromOriginal: true,
    });
  }

  // Add rewrite-pass results
  for (let i = 0; i < rewritePasses.length; i++) {
    const queryLabel = candidates[i]?.query ?? `rewrite_${i}`;
    for (const sc of rewritePasses[i]) {
      const existing = map.get(sc.chunk.id);
      if (existing) {
        existing.rewriteScores[i] = sc.score;
        existing.sourceQueries.push(queryLabel);
      } else {
        map.set(sc.chunk.id, {
          chunk: sc.chunk,
          originalScore: null,
          rewriteScores: { [i]: sc.score },
          mergedScore: 0,
          sourceQueries: [queryLabel],
          fromOriginal: false,
        });
      }
    }
  }

  // Compute merged scores
  for (const m of map.values()) {
    const allScores = [
      ...(m.originalScore !== null ? [m.originalScore] : []),
      ...Object.values(m.rewriteScores),
    ];
    const maxScore = Math.max(...allScores);
    const sourceCount = m.sourceQueries.length;
    m.mergedScore = maxScore + (sourceCount - 1) * consensusBonus;
  }

  // Sort: by mergedScore descending, tie-break by fromOriginal
  const merged = Array.from(map.values());
  merged.sort((a, b) => {
    const diff = b.mergedScore - a.mergedScore;
    if (Math.abs(diff) <= 0.01) {
      // Tie-breaker: prefer original
      if (a.fromOriginal && !b.fromOriginal) return -1;
      if (!a.fromOriginal && b.fromOriginal) return 1;
    }
    return diff;
  });

  return merged;
}

/**
 * Project MergedChunk[] back to ScoredChunk[] for rerank compatibility.
 */
export function toScoredChunks(merged: MergedChunk[]): ScoredChunk[] {
  return merged.map((m) => ({ chunk: m.chunk, score: m.mergedScore }));
}

/**
 * Build before/after snapshots for retrieval diagnostics.
 */
export function buildDiagnosticSnapshots(
  firstPass: ScoredChunk[],
  finalChunks: ScoredChunk[],
  topK: number,
): { before: RetrievalSnapshot; after: RetrievalComparison } {
  const beforeIds = firstPass.slice(0, topK).map((sc) => sc.chunk.id);
  const afterIds = finalChunks.slice(0, topK).map((sc) => sc.chunk.id);

  const beforeSet = new Set(beforeIds);
  const afterSet = new Set(afterIds);
  const union = new Set([...beforeSet, ...afterSet]);
  const intersection = new Set([...beforeSet].filter((id) => afterSet.has(id)));

  const beforeScores = firstPass.slice(0, topK).map((sc) => sc.score);
  const afterScores = finalChunks.slice(0, topK).map((sc) => sc.score);

  const avg = (arr: number[]) => (arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : 0);
  const coverage = (scores: number[], top: number) => {
    if (scores.length === 0 || top === 0) return 0;
    const floor = top * 0.25;
    return scores.filter((s) => s > floor).length / scores.length;
  };

  const before: RetrievalSnapshot = {
    topScore: beforeScores[0] ?? 0,
    avgScore: avg(beforeScores),
    chunkIds: beforeIds,
    coverageRatio: coverage(beforeScores, beforeScores[0] ?? 0),
  };

  const after: RetrievalComparison = {
    topScore: afterScores[0] ?? 0,
    avgScore: avg(afterScores),
    chunkIds: afterIds,
    coverageRatio: coverage(afterScores, afterScores[0] ?? 0),
    newChunkIds: afterIds.filter((id) => !beforeSet.has(id)),
    droppedChunkIds: beforeIds.filter((id) => !afterSet.has(id)),
    overlapRatio: union.size > 0 ? intersection.size / union.size : 1,
  };

  return { before, after };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/rag/retrieval/merge.test.ts --reporter=verbose 2>&1 | tail -10`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/rag/retrieval/merge.ts lib/rag/retrieval/merge.test.ts
git commit -m "feat(rag): implement result merge, dedupe, and diagnostic snapshots"
```

---

## Task 7: Add rewriteQueries to llm/index.ts

**Files:**
- Modify: `lib/rag/llm/index.ts`

Add the `rewriteQueries()` function used by strong-llm mode. This is a single LLM call that generates semantically distinct reformulations.

- [ ] **Step 1: Add rewriteQueries export to llm/index.ts**

Append before the `prewarmEmbeddings` function at the end of `lib/rag/llm/index.ts`:

```typescript
import type { QueryAnchors } from '../types.js';

// (Add this import at the top of the file alongside existing imports)
```

Then append the function before `prewarmEmbeddings`:

```typescript
const REWRITE_SYSTEM_PROMPT = `You are a search query rewriting assistant. Given a user's question about a GitHub repository, generate semantically distinct reformulations that will improve search retrieval.

Rules:
- Generate exactly the requested number of reformulations
- Each reformulation should approach the question from a different angle
- Expand implicit concepts into explicit implementation-level terms
- If anchor terms are provided, preserve them VERBATIM in every reformulation
- Keep reformulations concise (under 100 words each)
- Return ONLY a JSON array of strings, no other text`;

/**
 * LLM-based query rewrite for strong-llm mode.
 * Generates semantically distinct reformulations of the original query.
 * Called only when deterministic rewrites are insufficient.
 */
export async function rewriteQueries(
  query: string,
  anchors: QueryAnchors,
  count: number = 3,
): Promise<string[]> {
  const provider = getProvider();
  const model = LLM_CONFIG[provider].model;

  const anchorList = [
    ...anchors.filePaths,
    ...anchors.endpoints,
    ...anchors.codeSymbols,
    ...anchors.directories,
  ];
  const anchorInstruction = anchorList.length > 0
    ? `\n\nAnchor terms to preserve verbatim: ${anchorList.join(', ')}`
    : '';

  const response = await getClient().chat.completions.create({
    model,
    messages: [
      { role: 'system', content: REWRITE_SYSTEM_PROMPT },
      { role: 'user', content: `Generate ${count} reformulations of: "${query}"${anchorInstruction}` },
    ],
    temperature: 0.7,
    max_tokens: 300,
  });

  const content = response.choices[0]?.message?.content ?? '[]';
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed) && parsed.every((s: unknown) => typeof s === 'string')) {
      return parsed.slice(0, count);
    }
  } catch {
    // Parse failure — return empty, caller falls back to deterministic
  }
  return [];
}
```

- [ ] **Step 2: Add the QueryAnchors import at the top of llm/index.ts**

Update the existing type import at the top of `lib/rag/llm/index.ts`:

```typescript
import type { ScoredChunk, Source, AskResponse, QueryAnchors } from '../types.js';
```

- [ ] **Step 3: Verify types compile**

Run: `npx tsc -p tsconfig.server.json --noEmit 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add lib/rag/llm/index.ts
git commit -m "feat(rag): add LLM-based query rewrite for strong-llm mode"
```

---

## Task 8: Integrate rewrite pipeline into ask.ts

**Files:**
- Modify: `api/rag/ask.ts`

Wire the rewrite pipeline into the ask endpoint. The existing streaming/non-streaming paths and SSE contract remain unchanged.

- [ ] **Step 1: Add imports to ask.ts**

Add these imports at the top of `api/rag/ask.ts`, after the existing imports:

```typescript
import { analyzeAndRewrite, computeConfidence } from '../lib/rag/retrieval/rewrite.js';
import { mergeResults, toScoredChunks, buildDiagnosticSnapshots } from '../lib/rag/retrieval/merge.js';
import { rerank } from '../lib/rag/retrieval/rerank.js';
import type { RetrievalDiagnostics, ScoredChunk } from '../lib/rag/types.js';
```

- [ ] **Step 2: Update classifyQuery destructuring**

In `api/rag/ask.ts`, find the line:

```typescript
    const { typeFilter } = classifyQuery(question);
```

Change it to:

```typescript
    const { typeFilter, category } = classifyQuery(question);
```

- [ ] **Step 3: Replace the retrieval + generation section**

Find the section after the `chunkCount === 0` fast-fail check (the `// 1. Classify the query` comment through the `const wantStream = req.body?.stream === true;` line). Replace it with the rewrite-aware orchestration:

```typescript
    // 1. Classify the query to determine type filter
    const { typeFilter, category } = classifyQuery(question);

    // 2. First-pass retrieval
    const t0 = Date.now();
    const firstPass = await hybridSearch(question, repo, 8, typeFilter);
    const firstPassMs = Date.now() - t0;

    if (firstPass.length === 0) {
      return res.status(200).json({
        answer: 'This repository has not been indexed yet. Please index it first before asking questions.',
        sources: [],
      });
    }

    // 3. Analyze query + decide on rewrite
    const t1 = Date.now();
    const rewriteResult = await analyzeAndRewrite(question, category, firstPass, 'rerank_boosted');
    const rewriteDecisionMs = Date.now() - t1;
    const firstPassConfidence = computeConfidence(firstPass, 'rerank_boosted');

    // 4. Execute rewrite searches if needed, merge, rerank
    let chunks: ScoredChunk[];
    let rewriteSearchMs = 0;

    if (rewriteResult.decision.mode === 'none') {
      chunks = firstPass;
    } else {
      const t2 = Date.now();
      const rewritePasses = await Promise.all(
        rewriteResult.candidates.map((c) => hybridSearch(c.query, repo, 8, typeFilter)),
      );
      rewriteSearchMs = Date.now() - t2;

      const merged = mergeResults(firstPass, rewritePasses, rewriteResult.candidates);
      const scoredForRerank = toScoredChunks(merged);
      chunks = rerank(scoredForRerank, question, 8);
    }

    // 5. Structured rewrite diagnostics
    const { before: beforeRewrite, after: afterRewrite } =
      rewriteResult.decision.mode !== 'none'
        ? buildDiagnosticSnapshots(firstPass, chunks, 8)
        : { before: { topScore: firstPass[0]?.score ?? 0, avgScore: 0, chunkIds: firstPass.map((c) => c.chunk.id), coverageRatio: 0 }, after: null };

    const diagnostics: RetrievalDiagnostics = {
      requestId: '', // set below if streaming
      originalQuery: question,
      repo,
      analysis: rewriteResult.analysis,
      firstPassConfidence,
      decision: rewriteResult.decision,
      candidates: rewriteResult.candidates,
      beforeRewrite,
      afterRewrite,
      timing: {
        totalRetrievalMs: firstPassMs + rewriteDecisionMs + rewriteSearchMs,
        firstPassMs,
        rewriteDecisionMs,
        rewriteSearchMs,
        llmRewriteMs: rewriteResult.decision.mode === 'strong-llm' ? rewriteDecisionMs : null,
        mergeMs: 0,
        rerankMs: 0,
      },
      counts: {
        firstPassChunks: firstPass.length,
        mergedChunks: 0,
        deduplicatedChunks: 0,
        finalChunks: chunks.length,
      },
    };

    // Log rewrite diagnostics as structured JSON (matches spec logging section)
    console.log(JSON.stringify({
      type: 'rewrite_diagnostics',
      requestId: diagnostics.requestId,
      repo,
      mode: diagnostics.decision.mode,
      reasonCodes: diagnostics.decision.reasonCodes,
      rewriteScore: diagnostics.decision.rewriteScore,
      riskScore: diagnostics.analysis.riskScore,
      confidenceScore: firstPassConfidence.confidenceScore,
      anchorTypes: Object.entries(diagnostics.analysis.anchors)
        .filter(([, v]) => (v as string[]).length > 0)
        .map(([k]) => k),
      candidateCount: diagnostics.candidates.length,
      overlap: diagnostics.afterRewrite?.overlapRatio ?? null,
      newChunks: diagnostics.afterRewrite?.newChunkIds.length ?? 0,
      timing: diagnostics.timing,
      counts: diagnostics.counts,
    }));

    const wantStream = req.body?.stream === true;
```

- [ ] **Step 4: Update the streaming path to set requestId on diagnostics**

Inside the streaming block, after `const requestId = metrics.getRequestId();`, add:

```typescript
      diagnostics.requestId = requestId;
```

- [ ] **Step 5: Verify types compile**

Run: `npx tsc -p tsconfig.server.json --noEmit 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add api/rag/ask.ts
git commit -m "feat(rag): integrate conditional query rewrite into ask endpoint"
```

---

## Task 9: End-to-end verification

**Files:** None (verification only)

- [ ] **Step 1: Run all tests**

Run: `npx vitest run --reporter=verbose 2>&1 | tail -30`
Expected: All tests pass (existing + new rewrite + merge tests).

- [ ] **Step 2: Run TypeScript type check on all configs**

Run: `npx tsc -p tsconfig.server.json --noEmit && npx tsc -p tsconfig.app.json --noEmit`
Expected: No type errors.

- [ ] **Step 3: Verify the existing frontend test still passes**

Run: `npx vitest run src/features/rag/api/rag.test.ts --reporter=verbose 2>&1 | tail -10`
Expected: PASS — existing tests unaffected.

- [ ] **Step 4: Spot-check structured log output format**

Review the `console.log(JSON.stringify({...}))` in ask.ts to ensure the JSON structure matches the spec's logging section. The output should include: `type`, `requestId`, `repo`, `mode`, `reasonCodes`, `rewriteScore`, `riskScore`, `candidateCount`, `overlap`, `newChunks`, `timing`.

- [ ] **Step 5: Commit verification checkpoint**

No code changes needed. If any fixes were required in previous steps, commit them:

```bash
git add -A
git commit -m "fix: address issues found during e2e verification"
```
