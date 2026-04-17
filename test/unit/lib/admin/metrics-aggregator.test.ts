import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetEvalIndex, mockRedis } = vi.hoisted(() => ({
  mockGetEvalIndex: vi.fn(),
  mockRedis: {
    hgetall: vi.fn(),
  },
}));

vi.mock('../../../../lib/rag/storage/index.js', () => ({
  getEvalIndex: mockGetEvalIndex,
}));

vi.mock('@upstash/redis', () => ({
  Redis: vi.fn(class MockRedis {
    constructor() {
      return mockRedis;
    }
  }),
}));

import { aggregateDailyMetrics, _resetRedis } from '../../../../lib/admin/metrics-aggregator.js';

const DATE = '2026-04-18';
const DAY_START = new Date(`${DATE}T00:00:00Z`).getTime();

function makeHash(overrides: {
  retrievalCategory?: string;
  codeFetchFetched?: string[];
  codeFetchFailed?: Array<{ path: string; reason?: string }>;
  summaryOnlyFallback?: boolean;
  usedRetrievedCode?: boolean;
  tsOffset?: number;
} = {}): Record<string, string | undefined> {
  const ts = DAY_START + (overrides.tsOffset ?? 1000);
  const retrieval = overrides.retrievalCategory !== undefined
    ? JSON.stringify({ category: overrides.retrievalCategory, timestamp: ts })
    : undefined;
  const codeFetch = (overrides.codeFetchFetched !== undefined || overrides.codeFetchFailed !== undefined)
    ? JSON.stringify({
        fetchedFiles: overrides.codeFetchFetched ?? [],
        failedFiles: overrides.codeFetchFailed ?? [],
        summaryOnlyFallback: overrides.summaryOnlyFallback ?? false,
        timestamp: ts,
      })
    : undefined;
  const answer = overrides.usedRetrievedCode !== undefined
    ? JSON.stringify({ usedRetrievedCode: overrides.usedRetrievedCode, timestamp: ts })
    : undefined;
  return { retrieval, code_fetch: codeFetch, answer };
}

describe('aggregateDailyMetrics', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.UPSTASH_REDIS_REST_URL = 'https://fake-redis.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'fake-token';
    _resetRedis();
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('returns zero metrics for empty index set', async () => {
    mockGetEvalIndex.mockResolvedValue([]);

    const metrics = await aggregateDailyMetrics(DATE);

    expect(metrics.totalRequests).toBe(0);
    expect(metrics.codeFetchTriggerRate).toBe(0);
    expect(metrics.fetchSuccessRate).toBe(0);
    expect(metrics.summaryOnlyFallbackRate).toBe(0);
    expect(metrics.answerUsedRetrievedCodeRatio).toBe(0);
    expect(metrics.topSelectedFiles).toEqual([]);
  });

  it('skips malformed JSON in hash fields gracefully', async () => {
    mockGetEvalIndex.mockResolvedValueOnce(['req-1']).mockResolvedValueOnce([]);
    mockRedis.hgetall.mockResolvedValueOnce({ retrieval: 'not valid json{{{' });

    const metrics = await aggregateDailyMetrics(DATE);

    expect(metrics.totalRequests).toBe(0);
    expect(metrics.codeFetchTriggerRate).toBe(0);
  });

  it('calculates correct metrics with 2 requests, 1 code fetch, 1 failure', async () => {
    mockGetEvalIndex.mockResolvedValueOnce(['req-1', 'req-2']).mockResolvedValueOnce([]);
    mockRedis.hgetall
      .mockResolvedValueOnce(makeHash({
        retrievalCategory: 'code',
        codeFetchFetched: ['src/index.ts'],
        codeFetchFailed: [{ path: 'src/util.ts', reason: 'timeout' }],
        summaryOnlyFallback: false,
        usedRetrievedCode: true,
      }))
      .mockResolvedValueOnce(makeHash({
        retrievalCategory: 'general',
        usedRetrievedCode: false,
      }));

    const metrics = await aggregateDailyMetrics(DATE);

    expect(metrics.totalRequests).toBe(2);
    expect(metrics.categoryDistribution).toEqual({ code: 1, general: 1 });
    expect(metrics.codeFetchTriggerRate).toBe(1);
    expect(metrics.fetchSuccessRate).toBe(0.5);
    expect(metrics.summaryOnlyFallbackRate).toBe(0);
    expect(metrics.answerUsedRetrievedCodeRatio).toBe(0.5);
    expect(metrics.topSelectedFiles).toEqual([{ path: 'src/index.ts', count: 1 }]);
    expect(metrics.failureReasonDistribution).toEqual({ timeout: 1 });
  });

  it('returns 0 for division-by-zero cases', async () => {
    mockGetEvalIndex.mockResolvedValueOnce(['req-1']).mockResolvedValueOnce([]);
    mockRedis.hgetall.mockResolvedValueOnce(makeHash({ retrievalCategory: 'general' }));

    const metrics = await aggregateDailyMetrics(DATE);

    expect(metrics.codeFetchTriggerRate).toBe(0);
    expect(metrics.fetchSuccessRate).toBe(0);
    expect(metrics.summaryOnlyFallbackRate).toBe(0);
    expect(metrics.answerUsedRetrievedCodeRatio).toBe(0);
  });

  it('filters out events outside the calendar day window', async () => {
    mockGetEvalIndex.mockResolvedValueOnce(['req-old', 'req-new']).mockResolvedValueOnce([]);
    mockRedis.hgetall
      .mockResolvedValueOnce(makeHash({
        retrievalCategory: 'code',
        tsOffset: -1000,
      }))
      .mockResolvedValueOnce(makeHash({
        retrievalCategory: 'code',
        tsOffset: 1000,
      }));

    const metrics = await aggregateDailyMetrics(DATE);

    expect(metrics.totalRequests).toBe(1);
  });

  it('hydrates requestIds from the previous-day index for cross-midnight requests', async () => {
    mockGetEvalIndex
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(['req-cross-midnight']);
    mockRedis.hgetall.mockResolvedValueOnce(makeHash({
      retrievalCategory: 'code',
      tsOffset: 1000,
    }));

    const metrics = await aggregateDailyMetrics(DATE);

    expect(metrics.totalRequests).toBe(1);
    expect(metrics.categoryDistribution).toEqual({ code: 1 });
    expect(mockGetEvalIndex).toHaveBeenNthCalledWith(1, DATE);
    expect(mockGetEvalIndex).toHaveBeenNthCalledWith(2, '2026-04-17');
  });
});
