import type { ScoredChunk } from '../types.js';

/**
 * Lightweight reranker that boosts scores based on:
 * - Recency (newer chunks get a boost)
 * - Content length (prefer substantial chunks over tiny ones)
 * - Query term overlap in title
 */
export function rerank(
  results: ScoredChunk[],
  query: string,
  topK: number,
): ScoredChunk[] {
  const now = Date.now();
  const queryTerms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);

  const scored = results.map((sc) => {
    let boost = 0;

    // Recency boost: chunks from last 30 days get up to +0.15
    if (sc.chunk.metadata.createdAt) {
      const age = now - new Date(sc.chunk.metadata.createdAt).getTime();
      const daysOld = age / (1000 * 60 * 60 * 24);
      if (daysOld < 30) boost += 0.15 * (1 - daysOld / 30);
    }

    // Content length boost: prefer chunks with substantial content
    const len = sc.chunk.content.length;
    if (len > 200) boost += 0.05;
    if (len > 500) boost += 0.05;

    // Title match boost
    const titleLower = sc.chunk.metadata.title.toLowerCase();
    const titleMatches = queryTerms.filter((t) => titleLower.includes(t)).length;
    boost += titleMatches * 0.05;

    return { ...sc, score: sc.score + boost };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
