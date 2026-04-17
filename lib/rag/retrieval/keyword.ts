import MiniSearch from 'minisearch';
import type { ScoredChunk, ChunkType, QueryCategory } from '../types.js';
import { fetchAllRepoChunks } from '../storage/index.js';

/**
 * Perform keyword search using MiniSearch.
 *
 * Since we're in a serverless context, we rebuild the index on each request
 * from the stored chunks. This is fast for ~200 chunks.
 *
 * K1 isolation: non-code queries automatically exclude code_summary chunks
 * to prevent code noise from polluting documentation/community results.
 */
export async function keywordSearch(
  query: string,
  repo: string,
  topK: number = 20,
  typeFilter?: ChunkType[],
  queryCategory?: QueryCategory,
): Promise<ScoredChunk[]> {
  // K1: exclude code_summary for non-code queries when no explicit filter is set
  let effectiveFilter = typeFilter;
  if (!effectiveFilter && queryCategory !== 'code') {
    effectiveFilter = undefined; // fetch all, then post-filter
  }

  const allChunks = await fetchAllRepoChunks(repo, effectiveFilter);

  // K1 post-filter: exclude code_summary from non-code queries
  const filteredChunks = queryCategory === 'code'
    ? allChunks
    : allChunks.filter((sc) => sc.chunk.metadata.type !== 'code_summary');

  if (filteredChunks.length === 0) return [];

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

  const docs = filteredChunks.map((sc, i) => ({
    id: sc.chunk.id,
    _idx: i,
    content: sc.chunk.content,
    title: sc.chunk.metadata.title,
  }));

  miniSearch.addAll(docs);

  const results = miniSearch.search(query);

  // Map back to ScoredChunk
  const chunkMap = new Map(filteredChunks.map((sc) => [sc.chunk.id, sc.chunk]));
  const maxScore = results[0]?.score ?? 1;

  return results.slice(0, topK).map((r) => ({
    chunk: chunkMap.get(String(r.id))!,
    score: r.score / maxScore, // normalize to 0–1
  }));
}
