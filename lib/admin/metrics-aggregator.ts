import { getEvalIndex } from '../rag/storage/index.js';
import { Redis } from '@upstash/redis';

export interface DailyMetrics {
  date: string;
  totalRequests: number;
  categoryDistribution: Record<string, number>;
  codeFetchTriggerRate: number;
  fetchSuccessRate: number;
  summaryOnlyFallbackRate: number;
  topSelectedFiles: Array<{ path: string; count: number }>;
  failureReasonDistribution: Record<string, number>;
  answerUsedRetrievedCodeRatio: number;
}

let _redis: Redis | null = null;

/** Reset the Redis singleton — for testing only */
export function _resetRedis(): void {
  _redis = null;
}

function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  if (!_redis) {
    _redis = new Redis({ url, token });
  }
  return _redis;
}

function getEvalHashKey(requestId: string): string {
  return `rag:eval:${requestId}`;
}

function previousUtcDate(dateUtc: string): string {
  const d = new Date(`${dateUtc}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

const BATCH_SIZE = 50;

interface RetrievalEvent {
  category?: string;
  timestamp?: number;
}

interface CodeFetchEvent {
  fetchedFiles?: string[];
  failedFiles?: Array<{ path: string; reason?: string }>;
  summaryOnlyFallback?: boolean;
  timestamp?: number;
}

interface AnswerEvent {
  usedRetrievedCode?: boolean;
  timestamp?: number;
}

interface EvalHash {
  retrieval?: string;
  code_fetch?: string;
  answer?: string;
}

function parseJson<T>(raw: unknown): T | null {
  if (typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function fetchHashesBatch(
  r: Redis,
  requestIds: string[],
): Promise<EvalHash[]> {
  const results: EvalHash[] = [];
  for (let i = 0; i < requestIds.length; i += BATCH_SIZE) {
    const slice = requestIds.slice(i, i + BATCH_SIZE);
    const fetched = await Promise.all(
      slice.map((id) => r.hgetall(getEvalHashKey(id))),
    );
    for (const h of fetched) {
      results.push((h ?? {}) as EvalHash);
    }
  }
  return results;
}

export async function aggregateDailyMetrics(
  dateUtc: string,
): Promise<DailyMetrics> {
  const r = getRedis();

  const empty: DailyMetrics = {
    date: dateUtc,
    totalRequests: 0,
    categoryDistribution: {},
    codeFetchTriggerRate: 0,
    fetchSuccessRate: 0,
    summaryOnlyFallbackRate: 0,
    topSelectedFiles: [],
    failureReasonDistribution: {},
    answerUsedRetrievedCodeRatio: 0,
  };

  if (!r) return empty;

  // Read requestIds from the target day and the previous day so requests that
  // started before midnight but completed on the target day are still visible.
  const [todayIds, previousDayIds] = await Promise.all([
    getEvalIndex(dateUtc),
    getEvalIndex(previousUtcDate(dateUtc)),
  ]);
  const allIds = Array.from(new Set([...todayIds, ...previousDayIds]));

  if (allIds.length === 0) return empty;

  // Batch-fetch all hashes
  const hashes = await fetchHashesBatch(r, allIds);

  // Filter to the calendar day window for dateUtc
  const dayStart = new Date(`${dateUtc}T00:00:00Z`).getTime();
  const dayEnd = dayStart + 24 * 60 * 60 * 1000;

  const recentHashes = hashes.filter((h) => {
    const retrieval = parseJson<RetrievalEvent>(h.retrieval);
    const codeFetch = parseJson<CodeFetchEvent>(h.code_fetch);
    const answer = parseJson<AnswerEvent>(h.answer);
    const timestamps = [
      retrieval?.timestamp,
      codeFetch?.timestamp,
      answer?.timestamp,
    ].filter((t): t is number => typeof t === 'number');
    if (timestamps.length === 0) return false;
    const ts = Math.max(...timestamps);
    return ts >= dayStart && ts < dayEnd;
  });

  if (recentHashes.length === 0) return empty;

  let totalRequests = 0;
  const categoryDistribution: Record<string, number> = {};
  let codeRequestCount = 0;
  let codeFetchCount = 0;
  let fetchedFilesTotal = 0;
  let failedFilesTotal = 0;
  let summaryOnlyFallbackCount = 0;
  const fileCountMap: Record<string, number> = {};
  const failureReasonMap: Record<string, number> = {};
  let answerUsedCodeCount = 0;
  let answerTotal = 0;

  for (const h of recentHashes) {
    totalRequests += 1;

    const retrieval = parseJson<RetrievalEvent>(h.retrieval);
    const codeFetch = parseJson<CodeFetchEvent>(h.code_fetch);
    const answer = parseJson<AnswerEvent>(h.answer);

    // Category distribution
    if (retrieval?.category) {
      const cat = retrieval.category;
      categoryDistribution[cat] = (categoryDistribution[cat] ?? 0) + 1;
      if (cat === 'code') {
        codeRequestCount += 1;
      }
    }

    // Code fetch metrics
    if (codeFetch) {
      codeFetchCount += 1;

      const fetched = codeFetch.fetchedFiles ?? [];
      const failed = codeFetch.failedFiles ?? [];
      fetchedFilesTotal += fetched.length;
      failedFilesTotal += failed.length;

      // Track fetched files
      for (const path of fetched) {
        fileCountMap[path] = (fileCountMap[path] ?? 0) + 1;
      }

      // Failure reasons
      for (const f of failed) {
        const reason = f.reason ?? 'unknown';
        failureReasonMap[reason] = (failureReasonMap[reason] ?? 0) + 1;
      }

      if (codeFetch.summaryOnlyFallback) {
        summaryOnlyFallbackCount += 1;
      }
    }

    // Answer metrics
    if (answer) {
      answerTotal += 1;
      if (answer.usedRetrievedCode) {
        answerUsedCodeCount += 1;
      }
    }
  }

  // Top 10 selected files
  const topSelectedFiles = Object.entries(fileCountMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([path, count]) => ({ path, count }));

  const attemptedFiles = fetchedFilesTotal + failedFilesTotal;

  return {
    date: dateUtc,
    totalRequests,
    categoryDistribution,
    codeFetchTriggerRate:
      codeRequestCount > 0 ? codeFetchCount / codeRequestCount : 0,
    fetchSuccessRate:
      attemptedFiles > 0 ? fetchedFilesTotal / attemptedFiles : 0,
    summaryOnlyFallbackRate:
      codeFetchCount > 0 ? summaryOnlyFallbackCount / codeFetchCount : 0,
    topSelectedFiles,
    failureReasonDistribution: failureReasonMap,
    answerUsedRetrievedCodeRatio:
      answerTotal > 0 ? answerUsedCodeCount / answerTotal : 0,
  };
}
