import type { ScoredChunk, ChunkType } from '../types.js';
import { embedText } from '../embeddings/index.js';
import { queryVectors } from '../storage/index.js';

/** Perform vector similarity search */
export async function vectorSearch(
  query: string,
  repo: string,
  topK: number = 20,
  typeFilter?: ChunkType[],
): Promise<ScoredChunk[]> {
  const embedding = await embedText(query);

  let filter = `repo = '${repo}'`;
  if (typeFilter && typeFilter.length > 0) {
    const types = typeFilter.map((t) => `'${t}'`).join(', ');
    filter += ` AND type IN (${types})`;
  }

  return queryVectors(embedding, topK, filter);
}
