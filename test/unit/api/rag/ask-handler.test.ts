import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScoredChunk } from '../../../../lib/rag/types.js';

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  checkRateLimit: vi.fn(),
  countRepoChunks: vi.fn(),
  setStreamSessionSnapshot: vi.fn(),
  setStreamSessionProgress: vi.fn(),
  deleteStreamSession: vi.fn(),
  writeEvalEventBatch: vi.fn(),
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
  ServerMetricsRecorder: class MockServerMetricsRecorder {
    requestId = 'req_stream_123';
    setChunkCount = vi.fn();
    incrementEventCount = vi.fn();
    incrementErrorCount = vi.fn();
    recordError = vi.fn();

    getRequestId() {
      return this.requestId;
    }

    end() {
      return {
        requestId: 'req_stream_123',
        startTime: Date.now(),
        endTime: Date.now(),
        duration: 10,
        chunkCount: 1,
        eventCount: 4,
        errorCount: 0,
      };
    }
  },
  generateRequestId: vi.fn(() => 'req_nonstream_123'),
  categorizeError: vi.fn(),
  logStreamMetrics: vi.fn(),
}));

vi.mock('../../../../lib/rag/auth/index.js', () => ({
  authenticateRequest: mocks.authenticateRequest,
  checkRateLimit: mocks.checkRateLimit,
}));

vi.mock('../../../../lib/rag/storage/index.js', () => ({
  countRepoChunks: mocks.countRepoChunks,
  normalizeRepo: (repo: string) => repo.toLowerCase(),
  setStreamSessionSnapshot: mocks.setStreamSessionSnapshot,
  setStreamSessionProgress: mocks.setStreamSessionProgress,
  deleteStreamSession: mocks.deleteStreamSession,
  writeEvalEventBatch: mocks.writeEvalEventBatch,
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
  generateRequestId: mocks.generateRequestId,
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
  writes: string[];
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
    writes: [],
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
    write(chunk) {
      this.writes.push(chunk);
      this.headersSent = true;
    },
    end() {
      this.writable = false;
    },
  };
}

function createAsyncGenerator(chunks: string[]): AsyncGenerator<string> {
  return (async function* stream() {
    for (const chunk of chunks) {
      yield chunk;
    }
  })();
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
    mocks.buildSources.mockReturnValue([
      { type: 'issue', title: 'Source', url: 'https://github.com/owner/repo/issues/1' },
    ]);
    mocks.buildContextText.mockReturnValue('context text');
  });

  it('runs the non-streaming code path end-to-end and writes aligned eval events', async () => {
    const req = createMockReq({ repo: 'owner/repo', question: 'Where is retryHandler defined?' });
    const res = createMockRes();

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ requestId: 'non-stream-req_nonstream_123' });
    expect(mocks.fetchFileContentDetailed).toHaveBeenCalledWith(
      'owner/repo',
      'src/retry.ts',
      'gh-token',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(mocks.generateAnswer).toHaveBeenCalledTimes(1);
    expect(mocks.generateAnswer.mock.calls[0][3]).toContain('Live source code');
    expect(mocks.generateAnswer.mock.calls[0][3]).toContain('retryHandler');

    expect(mocks.writeEvalEventBatch).toHaveBeenCalledTimes(1);
    expect(mocks.writeEvalEventBatch.mock.calls[0][0]).toBe('non-stream-req_nonstream_123');
    expect(mocks.writeEvalEventBatch.mock.calls[0][1]).toMatchObject({
      retrieval: expect.objectContaining({ category: 'code', queryCategory: 'code' }),
      code_fetch: expect.objectContaining({
        fetchedFiles: ['src/retry.ts'],
        summaryOnlyFallback: false,
        usedSummaryOnlyFallback: false,
      }),
      answer: expect.objectContaining({
        usedRetrievedCode: true,
        hasCodeContext: true,
      }),
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
    expect(mocks.writeEvalEventBatch.mock.calls[0][1]).toMatchObject({
      code_fetch: expect.objectContaining({
        fetchedFiles: [],
        summaryOnlyFallback: true,
        usedSummaryOnlyFallback: true,
      }),
      answer: expect.objectContaining({
        usedRetrievedCode: false,
        hasCodeContext: false,
      }),
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
    expect(mocks.writeEvalEventBatch).not.toHaveBeenCalled();
  });

  it('streams SSE responses, persists session state, and writes eval events on completion', async () => {
    mocks.generateAnswerStream.mockReturnValue(createAsyncGenerator(['hello ', 'world']));

    const req = createMockReq({
      repo: 'owner/repo',
      question: 'Where is retryHandler defined?',
      stream: true,
    });
    const res = createMockRes();

    await handler(req as never, res as never);

    expect(res.headers['Content-Type']).toBe('text/event-stream');
    expect(res.headers['X-Request-ID']).toBe('req_stream_123');
    expect(mocks.setStreamSessionSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 'req_stream_123',
      repo: 'owner/repo',
      question: 'Where is retryHandler defined?',
      contextText: 'context text',
    }));
    expect(mocks.setStreamSessionProgress).toHaveBeenCalledWith('req_stream_123', {
      lastSeq: 0,
      partialAnswer: '',
    });
    expect(mocks.deleteStreamSession).toHaveBeenCalledWith('req_stream_123');
    expect(res.writes[0]).toContain('"type":"meta"');
    expect(res.writes.some((chunk) => chunk.includes('"type":"delta","seq":1,"content":"hello "'))).toBe(true);
    expect(res.writes.some((chunk) => chunk.includes('"type":"delta","seq":2,"content":"world"'))).toBe(true);
    expect(res.writes.some((chunk) => chunk.includes('"type":"sources"'))).toBe(true);
    expect(res.writes.some((chunk) => chunk.includes('[DONE]'))).toBe(true);
    expect(mocks.writeEvalEventBatch).toHaveBeenCalledTimes(1);
  });

  it('runs rewrite fan-out searches and reranks merged results when rewrite mode is enabled', async () => {
    const firstPassChunk = makeCodeChunk('src/first.ts', 1);
    const rewriteChunk = makeCodeChunk('src/rewrite.ts', 2);

    mocks.hybridSearch
      .mockResolvedValueOnce([firstPassChunk])
      .mockResolvedValueOnce([rewriteChunk]);
    mocks.analyzeAndRewrite.mockResolvedValue({
      analysis: { anchors: {}, riskScore: 0.8 },
      decision: { mode: 'strong', reasonCodes: ['low_confidence'], rewriteScore: 0.8 },
      candidates: [{ query: 'retry handler implementation', strategy: 'synonym' }],
    });
    mocks.mergeResults.mockReturnValue([
      { chunk: rewriteChunk.chunk, mergedScore: 2, fromOriginal: false, sourceQueries: ['candidate'] },
    ]);
    mocks.toScoredChunks.mockReturnValue([rewriteChunk]);
    mocks.rerank.mockReturnValue([rewriteChunk]);

    const req = createMockReq({ repo: 'owner/repo', question: 'How does retry work?' });
    const res = createMockRes();

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(mocks.hybridSearch).toHaveBeenCalledTimes(2);
    expect(mocks.hybridSearch.mock.calls[1][0]).toBe('retry handler implementation');
    expect(mocks.mergeResults).toHaveBeenCalledTimes(1);
    expect(mocks.toScoredChunks).toHaveBeenCalledTimes(1);
    expect(mocks.rerank).toHaveBeenCalledWith([rewriteChunk], 'How does retry work?', 8);
  });
});
