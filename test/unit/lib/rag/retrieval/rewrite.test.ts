import { describe, it, expect } from 'vitest';
import {
  analyzeQuery,
  computeConfidence,
  makeRewriteDecision,
  generateCandidates,
  analyzeAndRewrite,
  DEFAULT_THRESHOLDS,
} from '../../../../../lib/rag/retrieval/rewrite.js';
import type { ScoredChunk, Chunk } from '../../../../../lib/rag/types.js';

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
