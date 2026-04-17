import { Index } from '@upstash/vector';
import { Redis } from '@upstash/redis';
import type { Chunk, ChunkMetadata, ScoredChunk, Source } from '../types.js';

let index: Index | null = null;
let redis: Redis | null = null;

function getIndex(): Index {
  if (!index) {
    index = new Index({
      url: process.env.UPSTASH_VECTOR_REST_URL!,
      token: process.env.UPSTASH_VECTOR_REST_TOKEN!,
    });
  }
  return index;
}

function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  if (!redis) {
    redis = new Redis({ url, token });
  }

  return redis;
}

function getChunkCountKey(repo: string): string {
  return `rag:chunk-count:${normalizeRepo(repo)}`;
}

function normalizeRepo(repo: string): string {
  return repo.toLowerCase();
}

export async function setRepoChunkCount(repo: string, count: number): Promise<void> {
  const r = getRedis();
  if (!r) return;
  await r.set(getChunkCountKey(repo), Math.max(0, count));
}

async function getRepoChunkCount(repo: string): Promise<number | null> {
  const r = getRedis();
  if (!r) return null;
  const value = await r.get<number>(getChunkCountKey(repo));
  return typeof value === 'number' ? value : null;
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
  const normalizedRepo = normalizeRepo(repo);
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
      if (normalizeRepo(meta.repo ?? '') !== normalizedRepo) continue;
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
  const normalizedRepo = normalizeRepo(repo);
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
      if (meta && normalizeRepo((meta.repo as string | undefined) ?? '') === normalizedRepo) {
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

  await setRepoChunkCount(normalizedRepo, 0);
}

/** Count how many chunks exist for a repo */
export async function countRepoChunks(repo: string): Promise<number> {
  const normalizedRepo = normalizeRepo(repo);
  const cached = await getRepoChunkCount(normalizedRepo);
  if (cached !== null) return cached;

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
      if (meta && normalizeRepo((meta.repo as string | undefined) ?? '') === normalizedRepo) {
        count++;
      }
    }

    if (!page.nextCursor) break;
    cursor = Number(page.nextCursor);
  }

  await setRepoChunkCount(normalizedRepo, count);
  return count;
}

// -----------------------------------------------------------------------------
// Stream resume/session helpers
// -----------------------------------------------------------------------------

type StreamSession = {
  requestId: string;
  login: string;
  repo: string;
  question: string;
  createdAt: number; // ms
  lastSeq?: number;
  partialAnswer?: string;
  contextText?: string;
  contextPrefix?: string;
  sources?: Source[];
};

type StreamSessionSnapshot = {
  requestId: string;
  login: string;
  repo: string;
  question: string;
  createdAt: number; // ms
  contextText?: string;
  contextPrefix?: string;
  sources?: Source[];
};

type StreamSessionProgress = {
  lastSeq: number;
  partialAnswer: string;
  updatedAt: number;
};

function getStreamSessionKey(requestId: string): string {
  return `rag:stream:${requestId}`;
}

function getStreamSessionSnapshotKey(requestId: string): string {
  return `rag:stream:snapshot:${requestId}`;
}

function getStreamSessionProgressKey(requestId: string): string {
  return `rag:stream:progress:${requestId}`;
}

export async function setStreamSession(
  session: StreamSession,
  ttlSeconds = 60 * 5,
): Promise<void> {
  const r = getRedis();
  if (!r) return;
  const snapshot: StreamSessionSnapshot = {
    requestId: session.requestId,
    login: session.login,
    repo: session.repo,
    question: session.question,
    createdAt: session.createdAt,
    contextText: session.contextText,
    contextPrefix: session.contextPrefix,
    sources: session.sources,
  };

  const progress: StreamSessionProgress = {
    lastSeq: session.lastSeq ?? 0,
    partialAnswer: session.partialAnswer ?? '',
    updatedAt: Date.now(),
  };

  await Promise.all([
    r.set(getStreamSessionSnapshotKey(session.requestId), snapshot, { ex: ttlSeconds }),
    r.set(getStreamSessionProgressKey(session.requestId), progress, { ex: ttlSeconds }),
    // Legacy key kept for backwards compatibility with older deployments.
    r.set(getStreamSessionKey(session.requestId), session, { ex: ttlSeconds }),
  ]);
}

export async function setStreamSessionSnapshot(
  snapshot: StreamSessionSnapshot,
  ttlSeconds = 60 * 5,
): Promise<void> {
  const r = getRedis();
  if (!r) return;
  await r.set(getStreamSessionSnapshotKey(snapshot.requestId), snapshot, { ex: ttlSeconds });
}

export async function setStreamSessionProgress(
  requestId: string,
  progress: Pick<StreamSessionProgress, 'lastSeq' | 'partialAnswer'>,
  ttlSeconds = 60 * 5,
): Promise<void> {
  const r = getRedis();
  if (!r) return;
  const payload: StreamSessionProgress = {
    lastSeq: Math.max(0, progress.lastSeq),
    partialAnswer: progress.partialAnswer,
    updatedAt: Date.now(),
  };
  await r.set(getStreamSessionProgressKey(requestId), payload, { ex: ttlSeconds });
}

export async function getStreamSession(
  requestId: string,
): Promise<StreamSession | null> {
  const r = getRedis();
  if (!r) return null;
  const [snapshot, progress] = await Promise.all([
    r.get<StreamSessionSnapshot>(getStreamSessionSnapshotKey(requestId)),
    r.get<StreamSessionProgress>(getStreamSessionProgressKey(requestId)),
  ]);

  if (snapshot) {
    return {
      ...snapshot,
      lastSeq: progress?.lastSeq ?? 0,
      partialAnswer: progress?.partialAnswer ?? '',
    };
  }

  const legacy = await r.get<StreamSession>(getStreamSessionKey(requestId));
  return legacy ?? null;
}

export async function deleteStreamSession(requestId: string): Promise<void> {
  const r = getRedis();
  if (!r) return;
  await r.del(
    getStreamSessionKey(requestId),
    getStreamSessionSnapshotKey(requestId),
    getStreamSessionProgressKey(requestId),
  );
}

// -----------------------------------------------------------------------------
// Share link helpers
// -----------------------------------------------------------------------------

type ShareEntry = {
  id: string;
  repo: string;
  question: string;
  answer: string;
  sources: Source[];
  createdAt: number;
};

function getShareKey(shareId: string): string {
  return `rag:share:${shareId}`;
}

export async function setShareEntry(entry: ShareEntry, ttlSeconds = 60 * 60 * 24 * 7): Promise<void> {
  const r = getRedis();
  if (!r) return;
  await r.set(getShareKey(entry.id), entry, { ex: ttlSeconds });
}

export async function getShareEntry(shareId: string): Promise<ShareEntry | null> {
  const r = getRedis();
  if (!r) return null;
  const entry = await r.get<ShareEntry>(getShareKey(shareId));
  return entry ?? null;
}

export async function deleteShareEntry(shareId: string): Promise<void> {
  const r = getRedis();
  if (!r) return;
  await r.del(getShareKey(shareId));
}

// -----------------------------------------------------------------------------
// Evaluation event helpers
// -----------------------------------------------------------------------------

const EVAL_TTL_SECONDS = 60 * 60 * 24; // 24h

function getEvalKey(requestId: string): string {
  return `rag:eval:${requestId}`;
}

/** Write a single evaluation event field to the Redis Hash for a request */
export async function writeEvalEvent(
  requestId: string,
  eventType: string,
  data: Record<string, unknown>,
): Promise<void> {
  const r = getRedis();
  if (!r) return;
  const key = getEvalKey(requestId);
  await r.hset(key, { [eventType]: JSON.stringify({ ...data, timestamp: Date.now() }) });
  await r.expire(key, EVAL_TTL_SECONDS);
}

/** Write user feedback (thumbs up/down, retry) to the eval Hash */
export async function writeEvalFeedback(
  requestId: string,
  feedback: Record<string, unknown>,
): Promise<void> {
  const r = getRedis();
  if (!r) return;
  const key = getEvalKey(requestId);
  await r.hset(key, { feedback: JSON.stringify({ ...feedback, timestamp: Date.now() }) });
  await r.expire(key, EVAL_TTL_SECONDS);
}
