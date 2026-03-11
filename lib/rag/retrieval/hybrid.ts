import type { ScoredChunk, ChunkType } from '../types.js';
import { vectorSearch } from './vector.js';
import { keywordSearch } from './keyword.js';
import { rerank } from './rerank.js';

/**
 * Hybrid retrieval: combine vector + keyword results using
 * Reciprocal Rank Fusion (RRF), then rerank.
 */
export async function hybridSearch(
  query: string,
  repo: string,
  topK: number = 8,
  typeFilter?: ChunkType[],
): Promise<ScoredChunk[]> {
  // Run both searches in parallel
  const [vectorResults, keywordResults] = await Promise.all([
    vectorSearch(query, repo, 20, typeFilter),
    keywordSearch(query, repo, 20, typeFilter),
  ]);

  // Reciprocal Rank Fusion
  const K = 60; // RRF constant
  const fusedScores = new Map<string, { chunk: ScoredChunk['chunk']; score: number }>();

  const addResults = (results: ScoredChunk[], weight: number) => {
    results.forEach((sc, rank) => {
      const rrfScore = weight / (K + rank + 1);
      const existing = fusedScores.get(sc.chunk.id);
      if (existing) {
        existing.score += rrfScore;
      } else {
        fusedScores.set(sc.chunk.id, { chunk: sc.chunk, score: rrfScore });
      }
    });
  };

  addResults(vectorResults, 1.0);
  addResults(keywordResults, 1.0);

  // Sort by fused score
  const merged: ScoredChunk[] = Array.from(fusedScores.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, topK * 2) // take more than needed for reranking
    .map(({ chunk, score }) => ({ chunk, score }));

  // Rerank
  return rerank(merged, query, topK);
}
