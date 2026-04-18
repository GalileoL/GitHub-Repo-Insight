import { Index } from '@upstash/vector';
import { Redis } from '@upstash/redis';
import type { Chunk, ChunkMetadata, ScoredChunk, Source } from '../types.js';

let index: Index | null = null;
let redis: Redis | null = null;
type IndexRangePage = Awaited<ReturnType<Index['range']>>;

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

export function normalizeRepo(repo: string): string {
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
        repo: normalizeRepo(chunk.metadata.repo),
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

/** Prefixes for each chunk type as built in lib/rag/chunking/* */
const CORE_CHUNK_PREFIXES = ['readme', 'issue', 'pr', 'release', 'commits'] as const;
const CODE_CHUNK_PREFIX = 'code' as const;

async function fetchChunksByPrefix(
  repo: string,
  prefix: string,
  typeFilter?: string[],
): Promise<ScoredChunk[]> {
  const normalizedRepo = normalizeRepo(repo);
  const idx = getIndex();
  const results: ScoredChunk[] = [];
  let cursor: number | string = 0;

  while (true) {
    const page: IndexRangePage = await idx.range({
      cursor,
      limit: 100,
      prefix,
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
    cursor = page.nextCursor;
  }

  return results;
}

/**
 * Fetch only non-code chunks (readme/issue/pr/release/commit) via per-prefix
 * range scans. Iterates each core prefix separately so code_summary vectors
 * never hit the wire — this is the physical half of K1/K2 isolation.
 */
export async function fetchCoreRepoChunks(
  repo: string,
  typeFilter?: string[],
): Promise<ScoredChunk[]> {
  const normalizedRepo = normalizeRepo(repo);
  const pages = await Promise.all(
    CORE_CHUNK_PREFIXES.map((p) => fetchChunksByPrefix(normalizedRepo, `${normalizedRepo}:${p}`, typeFilter)),
  );
  return pages.flat();
}

/** Fetch only code_summary chunks via the dedicated prefix. */
export async function fetchCodeSummaryChunks(repo: string): Promise<ScoredChunk[]> {
  const normalizedRepo = normalizeRepo(repo);
  return fetchChunksByPrefix(normalizedRepo, `${normalizedRepo}:${CODE_CHUNK_PREFIX}:`);
}

/**
 * Fetch all chunks for a repo. Kept for backwards compatibility with callers
 * that still want everything in one pass (e.g. delete/count helpers). Prefer
 * `fetchCoreRepoChunks` + `fetchCodeSummaryChunks` for retrieval paths.
 */
export async function fetchAllRepoChunks(
  repo: string,
  typeFilter?: string[],
): Promise<ScoredChunk[]> {
  const wantsCode = !typeFilter || typeFilter.length === 0 || typeFilter.includes('code_summary');
  const wantsCore = !typeFilter || typeFilter.length === 0 ||
    typeFilter.some((t) => t !== 'code_summary');

  const calls: Promise<ScoredChunk[]>[] = [];
  if (wantsCore) calls.push(fetchCoreRepoChunks(repo, typeFilter));
  if (wantsCode) calls.push(fetchCodeSummaryChunks(repo));

  const pages = await Promise.all(calls);
  return pages.flat();
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

const EVAL_TTL_SECONDS = 60 * 60 * 48; // 48h — matches index TTL to prevent stale-hash lookups

const EVAL_INDEX_TTL_HOURS = Number(process.env.EVAL_INDEX_TTL_HOURS ?? 48);
const EVAL_INDEX_TTL_SECONDS = EVAL_INDEX_TTL_HOURS * 60 * 60;

function getEvalKey(requestId: string): string {
  return `rag:eval:${requestId}`;
}

export function getEvalIndexKey(date: string): string {
  return `rag:eval:index:${date}`;
}

type EvalHash = Record<string, string>;

function withEvalTimestamp(data: Record<string, unknown>): string {
  return JSON.stringify({ ...data, timestamp: Date.now() });
}

async function indexEvalRequest(
  r: Redis,
  requestId: string,
  dateUtc: string,
): Promise<string> {
  const indexKey = getEvalIndexKey(dateUtc);
  await r.sadd(indexKey, requestId);
  await r.expire(indexKey, EVAL_INDEX_TTL_SECONDS);
  return indexKey;
}

/** Return all requestIds recorded for a given UTC date (YYYY-MM-DD) */
export async function getEvalIndex(date: string): Promise<string[]> {
  const r = getRedis();
  if (!r) return [];
  const members = await r.smembers(getEvalIndexKey(date));
  return (members ?? []).filter((m): m is string => typeof m === 'string');
}

export async function getEvalFields(
  requestId: string,
  fields?: string[],
): Promise<EvalHash | null> {
  const r = getRedis();
  if (!r) return {};
  try {
    const hash = await r.hgetall<EvalHash>(getEvalKey(requestId));
    if (!hash) return {};
    if (!fields || fields.length === 0) return hash;

    const filtered: EvalHash = {};
    for (const field of fields) {
      if (typeof hash[field] === 'string') {
        filtered[field] = hash[field];
      }
    }
    return filtered;
  } catch {
    return null;
  }
}

/** Write a single evaluation event field to the Redis Hash for a request */
export async function writeEvalEvent(
  requestId: string,
  eventType: string,
  data: Record<string, unknown>,
): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    const key = getEvalKey(requestId);
    const dateUtc = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    await indexEvalRequest(r, requestId, dateUtc);
    await r.hset(key, { [eventType]: withEvalTimestamp(data) });
    await Promise.allSettled([
      r.expire(key, EVAL_TTL_SECONDS),
    ]);
  } catch {
    // best-effort: silently ignore
  }
}

/** Write multiple evaluation event fields in one Hash update for a request */
export async function writeEvalEventBatch(
  requestId: string,
  events: Record<string, Record<string, unknown> | undefined>,
): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    const entries = Object.entries(events).filter(
      (entry): entry is [string, Record<string, unknown>] => entry[1] !== undefined,
    );
    if (entries.length === 0) return;

    const dateUtc = new Date().toISOString().slice(0, 10);
    const indexKey = await indexEvalRequest(r, requestId, dateUtc);

    const payload = Object.fromEntries(
      entries.map(([field, value]) => [field, withEvalTimestamp(value)]),
    );

    try {
      await r.hset(getEvalKey(requestId), payload);
    } catch {
      await Promise.allSettled([
        r.srem(indexKey, requestId),
      ]);
      return;
    }

    try {
      await r.expire(getEvalKey(requestId), EVAL_TTL_SECONDS);
    } catch {
      // best-effort: retain the indexed hash even if TTL refresh fails
    }
  } catch {
    // best-effort: silently ignore
  }
}

/** Write user feedback (thumbs up/down, retry) to the eval Hash */
export async function writeEvalFeedback(
  requestId: string,
  feedback: Record<string, unknown>,
): Promise<boolean> {
  const r = getRedis();
  if (!r) return false;
  try {
    const key = getEvalKey(requestId);
    const feedbackFields = Object.fromEntries(
      Object.entries(feedback).map(([field, value]) => [
        `feedback:${field}`,
        JSON.stringify(value),
      ]),
    );
    await r.hset(key, {
      ...feedbackFields,
      'feedback:timestamp': String(Date.now()),
    });
    await r.expire(key, EVAL_TTL_SECONDS);
    return true;
  } catch {
    return false;
  }
}
