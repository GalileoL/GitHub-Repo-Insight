import MiniSearch from 'minisearch';
import type { ScoredChunk, ChunkType } from '../types.js';
import { fetchAllRepoChunks } from '../storage/index.js';

/**
 * Perform keyword search using MiniSearch.
 *
 * Since we're in a serverless context, we rebuild the index on each request
 * from the stored chunks. This is fast for ~200 chunks.
 */
export async function keywordSearch(
  query: string,
  repo: string,
  topK: number = 20,
  typeFilter?: ChunkType[],
): Promise<ScoredChunk[]> {
  const allChunks = await fetchAllRepoChunks(repo, typeFilter);

  if (allChunks.length === 0) return [];

  // Build MiniSearch index
  const miniSearch = new MiniSearch<{ id: string; content: string; title: string }>({
    fields: ['content', 'title'],
    storeFields: ['id'],
    searchOptions: {
      boost: { title: 2 },
      fuzzy: 0.2,
      prefix: true,
    },
  });

  const docs = allChunks.map((sc, i) => ({
    id: sc.chunk.id,
    _idx: i,
    content: sc.chunk.content,
    title: sc.chunk.metadata.title,
  }));

  miniSearch.addAll(docs);

  const results = miniSearch.search(query);

  // Map back to ScoredChunk
  const chunkMap = new Map(allChunks.map((sc) => [sc.chunk.id, sc.chunk]));
  const maxScore = results[0]?.score ?? 1;

  return results.slice(0, topK).map((r) => ({
    chunk: chunkMap.get(String(r.id))!,
    score: r.score / maxScore, // normalize to 0–1
  }));
}
