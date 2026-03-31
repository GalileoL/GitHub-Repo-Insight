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
