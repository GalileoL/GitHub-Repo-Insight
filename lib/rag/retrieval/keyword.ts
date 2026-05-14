import MiniSearch from 'minisearch';
import type { ScoredChunk, ChunkType, QueryCategory } from '../types.js';
import {
  fetchCoreRepoChunks,
  fetchCodeSummaryChunks,
  fetchAllRepoChunks,
} from '../storage/index.js';

/**
 * Perform keyword search using MiniSearch.
 *
 * Rebuilds the MiniSearch index on each request because we are in a
 * serverless context.
 *
 * K1/K2 isolation: the fetch path differs by queryCategory so that code_summary
 * vectors are never loaded (or shipped over the wire) for non-code queries,
 * and core repo chunks are never loaded for pure code retrieval.
 */
export async function keywordSearch(
  query: string,
  repo: string,
  topK: number = 20,
  typeFilter?: ChunkType[],
  queryCategory?: QueryCategory,
): Promise<ScoredChunk[]> {
  const allChunks = await loadChunksForCategory(repo, typeFilter, queryCategory);

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

async function loadChunksForCategory(
  repo: string,
  typeFilter: ChunkType[] | undefined,
  queryCategory: QueryCategory | undefined,
): Promise<ScoredChunk[]> {
  // Explicit filter wins: honour exactly what the caller asked for.
  if (typeFilter && typeFilter.length > 0) {
    const wantsCode = typeFilter.includes('code_summary');
    const coreFilter = typeFilter.filter((t) => t !== 'code_summary');

    const [core, code] = await Promise.all([
      coreFilter.length > 0 ? fetchCoreRepoChunks(repo, coreFilter) : Promise.resolve([]),
      wantsCode ? fetchCodeSummaryChunks(repo) : Promise.resolve([]),
    ]);
    return [...core, ...code];
  }

  // No explicit filter: decide by query category.
  if (queryCategory === 'code') {
    // Code queries still need core chunks for context (readme/pr/commit), plus
    // code summaries. Fetch both and let rerank decide.
    const [core, code] = await Promise.all([
      fetchCoreRepoChunks(repo),
      fetchCodeSummaryChunks(repo),
    ]);
    return [...core, ...code];
  }

  if (queryCategory) {
    // Non-code queries skip code_summary entirely — physical K2 isolation.
    return fetchCoreRepoChunks(repo);
  }

  // Unknown category: conservative default — return everything.
  return fetchAllRepoChunks(repo);
}
