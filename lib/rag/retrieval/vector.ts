import type { ScoredChunk, ChunkType, QueryCategory } from '../types.js';
import { embedText } from '../embeddings/index.js';
import { normalizeRepo, queryVectors } from '../storage/index.js';

/** Perform vector similarity search */
export async function vectorSearch(
  query: string,
  repo: string,
  topK: number = 20,
  typeFilter?: ChunkType[],
  queryCategory?: QueryCategory,
): Promise<ScoredChunk[]> {
  const embedding = await embedText(query);
  const normalizedRepo = normalizeRepo(repo);

  let filter = `repo = '${normalizedRepo}'`;
  if (typeFilter && typeFilter.length > 0) {
    const types = typeFilter.map((t) => `'${t}'`).join(', ');
    filter += ` AND type IN (${types})`;
  } else if (queryCategory && queryCategory !== 'code') {
    filter += ` AND type != 'code_summary'`;
  }

  return queryVectors(embedding, topK, filter);
}
