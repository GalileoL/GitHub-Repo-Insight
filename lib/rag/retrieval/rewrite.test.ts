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
