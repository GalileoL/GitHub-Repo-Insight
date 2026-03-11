import { Index } from '@upstash/vector';
import type { Chunk, ChunkMetadata, ScoredChunk } from '../types.js';

let index: Index | null = null;

function getIndex(): Index {
  if (!index) {
    index = new Index({
      url: process.env.UPSTASH_VECTOR_REST_URL!,
      token: process.env.UPSTASH_VECTOR_REST_TOKEN!,
    });
  }
  return index;
}

/** Upsert chunks with pre-computed embeddings into the vector DB */
export async function upsertChunks(
  chunks: Chunk[],
  embeddings: number[][],
): Promise<void> {
  const idx = getIndex();
  const BATCH = 100;

  for (let i = 0; i < chunks.length; i += BATCH) {
    const batch = chunks.slice(i, i + BATCH);
    const vectors = batch.map((chunk, j) => ({
      id: chunk.id,
      vector: embeddings[i + j],
      metadata: {
        ...chunk.metadata,
        content: chunk.content.slice(0, 2000), // store truncated content for retrieval
      },
    }));
    await idx.upsert(vectors);
  }
}

/** Query vector DB for similar chunks */
export async function queryVectors(
  embedding: number[],
  topK: number,
  filter?: string,
): Promise<ScoredChunk[]> {
  const idx = getIndex();

  const results = await idx.query({
    vector: embedding,
    topK,
    includeMetadata: true,
    filter,
  });

  return results.map((r) => {
    const meta = (r.metadata ?? {}) as unknown as ChunkMetadata & { content?: string };
    const content = meta.content ?? '';
    // Remove content from metadata copy
    const { content: _content, ...cleanMeta } = meta;
    void _content;

    return {
      chunk: {
        id: String(r.id),
        content,
        metadata: cleanMeta as ChunkMetadata,
      },
      score: r.score,
    };
  });
}

/** Fetch all chunks for a repo using range (not affected by zero-vector issues) */
export async function fetchAllRepoChunks(
  repo: string,
  typeFilter?: string[],
): Promise<ScoredChunk[]> {
  const idx = getIndex();
  const results: ScoredChunk[] = [];
  let cursor = 0;

  while (true) {
    const page = await idx.range({
      cursor,
      limit: 100,
      includeMetadata: true,
    });

    for (const v of page.vectors) {
      const meta = (v.metadata ?? {}) as unknown as ChunkMetadata & { content?: string };
      if (meta.repo !== repo) continue;
      if (typeFilter && typeFilter.length > 0 && !typeFilter.includes(meta.type)) continue;

      const content = meta.content ?? '';
      const { content: _content, ...cleanMeta } = meta;
      void _content;

      results.push({
        chunk: {
          id: String(v.id),
          content,
          metadata: cleanMeta as ChunkMetadata,
        },
        score: 1,
      });
    }

    if (!page.nextCursor) break;
    cursor = Number(page.nextCursor);
  }

  return results;
}

/** Delete all chunks for a repo */
export async function deleteRepoChunks(repo: string): Promise<void> {
  const idx = getIndex();
  const idsToDelete: string[] = [];
  let cursor = 0;

  while (true) {
    const page = await idx.range({
      cursor,
      limit: 100,
      includeMetadata: true,
    });

    for (const v of page.vectors) {
      const meta = v.metadata as Record<string, unknown> | undefined;
      if (meta && meta.repo === repo) {
        idsToDelete.push(String(v.id));
      }
    }

    if (!page.nextCursor) break;
    cursor = Number(page.nextCursor);
  }

  if (idsToDelete.length > 0) {
    const BATCH = 100;
    for (let i = 0; i < idsToDelete.length; i += BATCH) {
      await idx.delete(idsToDelete.slice(i, i + BATCH));
    }
  }
}

/** Count how many chunks exist for a repo */
export async function countRepoChunks(repo: string): Promise<number> {
  const idx = getIndex();
  let count = 0;
  let cursor = 0;

  // Use range to iterate and count vectors matching the repo prefix
  while (true) {
    const page = await idx.range({
      cursor,
      limit: 100,
      includeMetadata: true,
    });

    for (const v of page.vectors) {
      const meta = v.metadata as Record<string, unknown> | undefined;
      if (meta && meta.repo === repo) {
        count++;
      }
    }

    if (!page.nextCursor) break;
    cursor = Number(page.nextCursor);
  }

  return count;
}
