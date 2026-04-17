import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScoredChunk } from '../../../../lib/rag/types.js';

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  checkRateLimit: vi.fn(),
  countRepoChunks: vi.fn(),
  setStreamSessionSnapshot: vi.fn(),
  setStreamSessionProgress: vi.fn(),
  deleteStreamSession: vi.fn(),
  writeEvalEvent: vi.fn(),
  classifyQuery: vi.fn(),
  hybridSearch: vi.fn(),
  generateAnswer: vi.fn(),
  generateAnswerStream: vi.fn(),
  buildSources: vi.fn(),
  buildContextText: vi.fn(),
  analyzeAndRewrite: vi.fn(),
  computeConfidence: vi.fn(),
  mergeResults: vi.fn(),
  toScoredChunks: vi.fn(),
  buildDiagnosticSnapshots: vi.fn(),
  rerank: vi.fn(),
  classifyIntent: vi.fn(),
  executeAnalyticsQuery: vi.fn(),
  fetchFileContentDetailed: vi.fn(),
  incrementAlertStreak: vi.fn(),
  resetAlertStreak: vi.fn(),
  checkAndFireStreakAlert: vi.fn(),
  ServerMetricsRecorder: vi.fn(),
  categorizeError: vi.fn(),
  logStreamMetrics: vi.fn(),
}));

vi.mock('../../../../lib/rag/auth/index.js', () => ({
  authenticateRequest: mocks.authenticateRequest,
  checkRateLimit: mocks.checkRateLimit,
}));

vi.mock('../../../../lib/rag/storage/index.js', () => ({
  countRepoChunks: mocks.countRepoChunks,
  setStreamSessionSnapshot: mocks.setStreamSessionSnapshot,
  setStreamSessionProgress: mocks.setStreamSessionProgress,
  deleteStreamSession: mocks.deleteStreamSession,
  writeEvalEvent: mocks.writeEvalEvent,
}));

vi.mock('../../../../lib/rag/retrieval/router.js', () => ({
  classifyQuery: mocks.classifyQuery,
}));

vi.mock('../../../../lib/rag/retrieval/hybrid.js', () => ({
  hybridSearch: mocks.hybridSearch,
}));

vi.mock('../../../../lib/rag/llm/index.js', () => ({
  generateAnswer: mocks.generateAnswer,
  generateAnswerStream: mocks.generateAnswerStream,
  buildSources: mocks.buildSources,
  buildContextText: mocks.buildContextText,
}));

vi.mock('../../../../lib/rag/retrieval/rewrite.js', () => ({
  analyzeAndRewrite: mocks.analyzeAndRewrite,
  computeConfidence: mocks.computeConfidence,
}));

vi.mock('../../../../lib/rag/retrieval/merge.js', () => ({
  mergeResults: mocks.mergeResults,
  toScoredChunks: mocks.toScoredChunks,
  buildDiagnosticSnapshots: mocks.buildDiagnosticSnapshots,
}));

vi.mock('../../../../lib/rag/retrieval/rerank.js', () => ({
  rerank: mocks.rerank,
}));

vi.mock('../../../../lib/rag/intents/index.js', () => ({
  classifyIntent: mocks.classifyIntent,
  executeAnalyticsQuery: mocks.executeAnalyticsQuery,
}));

vi.mock('../../../../lib/rag/github/fetchers.js', () => ({
  fetchFileContentDetailed: mocks.fetchFileContentDetailed,
}));

vi.mock('../../../../lib/admin/alert-manager.js', () => ({
  incrementAlertStreak: mocks.incrementAlertStreak,
  resetAlertStreak: mocks.resetAlertStreak,
  checkAndFireStreakAlert: mocks.checkAndFireStreakAlert,
}));

vi.mock('../../../../lib/rag/metrics/index.js', () => ({
  ServerMetricsRecorder: mocks.ServerMetricsRecorder,
  categorizeError: mocks.categorizeError,
  logStreamMetrics: mocks.logStreamMetrics,
}));

import handler from '../../../../api/rag/ask.js';

type MockReq = {
  method?: string;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
  on: (event: string, cb: (...args: unknown[]) => void) => void;
  removeListener: (event: string, cb: (...args: unknown[]) => void) => void;
};

type MockRes = {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
  writable: boolean;
  headersSent: boolean;
  status: (code: number) => MockRes;
  json: (payload: unknown) => MockRes;
  setHeader: (name: string, value: string) => void;
  write: (chunk: string) => void;
  end: () => void;
};

function createMockReq(body: Record<string, unknown>): MockReq {
  return {
    method: 'POST',
    body,
    headers: {},
    on: vi.fn(),
    removeListener: vi.fn(),
  };
}

function createMockRes(): MockRes {
  return {
    statusCode: 200,
    body: undefined,
    headers: {},
    writable: true,
    headersSent: false,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      this.headersSent = true;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    write() {
      this.headersSent = true;
    },
    end() {
      this.writable = false;
    },
  };
}

function makeCodeChunk(path: string, score = 1): ScoredChunk {
  return {
    chunk: {
      id: `owner/repo:code:${path}`,
      content: `summary for ${path}`,
      metadata: {
        repo: 'owner/repo',
        type: 'code_summary',
        title: path,
        githubUrl: `https://github.com/owner/repo/blob/main/${path}`,
        filePath: path,
        symbolNames: ['retryHandler'],
      },
    },
    score,
  };
}

describe('api/rag/ask handler integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.authenticateRequest.mockResolvedValue({
      authenticated: true,
      login: 'alice',
      token: 'gh-token',
    });
    mocks.checkRateLimit.mockResolvedValue({
      allowed: true,
      limit: 20,
      remaining: 19,
    });
    mocks.countRepoChunks.mockResolvedValue(10);
    mocks.classifyIntent.mockReturnValue({
      intent: 'semantic_qa',
      analyticsQuery: null,
    });
    mocks.classifyQuery.mockReturnValue({
      category: 'code',
      typeFilter: ['code_summary'],
    });
    mocks.hybridSearch.mockResolvedValue([makeCodeChunk('src/retry.ts')]);
    mocks.analyzeAndRewrite.mockResolvedValue({
      analysis: { anchors: {}, riskScore: 0.1 },
      decision: { mode: 'none', reasonCodes: ['confident'], rewriteScore: 0.1 },
      candidates: [],
    });
    mocks.computeConfidence.mockReturnValue({
      confidenceScore: 0.9,
      topScore: 0.92,
      avgScore: 0.9,
      coverageRatio: 1,
    });
    mocks.buildDiagnosticSnapshots.mockReturnValue({
      before: { topScore: 0.92, avgScore: 0.9, chunkIds: ['id-1'], coverageRatio: 1 },
      after: null,
    });
    mocks.generateAnswer.mockResolvedValue({
      answer: 'Generated answer',
      sources: [{ type: 'issue', title: 'Source', url: 'https://github.com/owner/repo/issues/1' }],
    });
    mocks.fetchFileContentDetailed.mockResolvedValue({
      ok: true,
      content: 'export function retryHandler() {\n  return true;\n}',
    });
    mocks.resetAlertStreak.mockResolvedValue(undefined);
    mocks.incrementAlertStreak.mockResolvedValue(undefined);
    mocks.checkAndFireStreakAlert.mockResolvedValue(undefined);
  });

  it('runs the non-streaming code path end-to-end and writes aligned eval events', async () => {
    const req = createMockReq({ repo: 'owner/repo', question: 'Where is retryHandler defined?' });
    const res = createMockRes();

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(mocks.fetchFileContentDetailed).toHaveBeenCalledWith('owner/repo', 'src/retry.ts', 'gh-token');
    expect(mocks.generateAnswer).toHaveBeenCalledTimes(1);
    expect(mocks.generateAnswer.mock.calls[0][3]).toContain('Live source code');
    expect(mocks.generateAnswer.mock.calls[0][3]).toContain('retryHandler');

    expect(mocks.writeEvalEvent).toHaveBeenCalledTimes(3);
    expect(mocks.writeEvalEvent.mock.calls[0][1]).toBe('retrieval');
    expect(mocks.writeEvalEvent.mock.calls[0][2]).toMatchObject({ category: 'code', queryCategory: 'code' });
    expect(mocks.writeEvalEvent.mock.calls[1][1]).toBe('code_fetch');
    expect(mocks.writeEvalEvent.mock.calls[1][2]).toMatchObject({
      fetchedFiles: ['src/retry.ts'],
      summaryOnlyFallback: false,
      usedSummaryOnlyFallback: false,
    });
    expect(mocks.writeEvalEvent.mock.calls[2][1]).toBe('answer');
    expect(mocks.writeEvalEvent.mock.calls[2][2]).toMatchObject({
      usedRetrievedCode: true,
      hasCodeContext: true,
    });

    expect(mocks.resetAlertStreak).toHaveBeenCalledWith('timeout_streak', 'owner/repo');
    expect(mocks.resetAlertStreak).toHaveBeenCalledWith('code_fetch_failure_streak', 'owner/repo');
    expect(mocks.incrementAlertStreak).not.toHaveBeenCalled();
  });

  it('degrades to summary-only and increments alert streaks once per request when fetches fail', async () => {
    mocks.hybridSearch.mockResolvedValue([
      makeCodeChunk('src/a.ts', 3),
      makeCodeChunk('src/b.ts', 2),
      makeCodeChunk('src/c.ts', 1),
    ]);
    mocks.fetchFileContentDetailed
      .mockResolvedValueOnce({ ok: false, reason: 'timeout' })
      .mockResolvedValueOnce({ ok: false, reason: 'forbidden' })
      .mockResolvedValueOnce({ ok: false, reason: 'timeout' });

    const req = createMockReq({ repo: 'owner/repo', question: 'Show me the retry implementation' });
    const res = createMockRes();

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(mocks.generateAnswer.mock.calls[0][3]).toBeUndefined();
    expect(mocks.writeEvalEvent.mock.calls[1][2]).toMatchObject({
      fetchedFiles: [],
      summaryOnlyFallback: true,
      usedSummaryOnlyFallback: true,
    });
    expect(mocks.writeEvalEvent.mock.calls[2][2]).toMatchObject({
      usedRetrievedCode: false,
      hasCodeContext: false,
    });

    expect(mocks.incrementAlertStreak).toHaveBeenCalledTimes(2);
    expect(mocks.incrementAlertStreak).toHaveBeenCalledWith('timeout_streak', 'owner/repo');
    expect(mocks.incrementAlertStreak).toHaveBeenCalledWith('code_fetch_failure_streak', 'owner/repo');
    expect(mocks.checkAndFireStreakAlert).toHaveBeenCalledTimes(2);
  });

  it('short-circuits pure analytics queries without touching retrieval', async () => {
    mocks.classifyIntent.mockReturnValue({
      intent: 'repo_analytics',
      analyticsQuery: { entity: 'pr', op: 'count', state: 'all', dateRange: null },
    });
    mocks.executeAnalyticsQuery.mockResolvedValue({
      answer: 'There are 42 pull requests.',
      data: {
        entity: 'pr',
        op: 'count',
        state: 'all',
        count: 42,
        dateRange: null,
      },
    });

    const req = createMockReq({ repo: 'owner/repo', question: 'How many PRs are there?' });
    const res = createMockRes();

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ answer: 'There are 42 pull requests.', sources: [] });
    expect(mocks.hybridSearch).not.toHaveBeenCalled();
    expect(mocks.classifyQuery).not.toHaveBeenCalled();
    expect(mocks.generateAnswer).not.toHaveBeenCalled();
    expect(mocks.writeEvalEvent).not.toHaveBeenCalled();
  });
});
