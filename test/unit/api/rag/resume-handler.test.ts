import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  checkRateLimit: vi.fn(),
  countRepoChunks: vi.fn(),
  getStreamSession: vi.fn(),
  setStreamSessionSnapshot: vi.fn(),
  setStreamSessionProgress: vi.fn(),
  deleteStreamSession: vi.fn(),
  classifyQuery: vi.fn(),
  hybridSearch: vi.fn(),
  generateAnswerStream: vi.fn(),
  generateAnswerStreamFromContext: vi.fn(),
  buildSources: vi.fn(),
  buildContextText: vi.fn(),
  codeFetchStage: vi.fn(),
  ServerMetricsRecorder: class MockServerMetricsRecorder {
    requestId = 'req_resume_123';
    setChunkCount = vi.fn();
    incrementEventCount = vi.fn();
    incrementErrorCount = vi.fn();
    recordError = vi.fn();

    getRequestId() {
      return this.requestId;
    }

    end() {
      return {
        requestId: 'req_resume_123',
        startTime: Date.now(),
        endTime: Date.now(),
        duration: 10,
        chunkCount: 1,
        eventCount: 4,
        errorCount: 0,
      };
    }
  },
  categorizeError: vi.fn(),
  logStreamMetrics: vi.fn(),
}));

vi.mock('../../../../lib/rag/auth/index.js', () => ({
  authenticateRequest: mocks.authenticateRequest,
  checkRateLimit: mocks.checkRateLimit,
}));

vi.mock('../../../../lib/rag/storage/index.js', () => ({
  countRepoChunks: mocks.countRepoChunks,
  getStreamSession: mocks.getStreamSession,
  setStreamSessionSnapshot: mocks.setStreamSessionSnapshot,
  setStreamSessionProgress: mocks.setStreamSessionProgress,
  deleteStreamSession: mocks.deleteStreamSession,
}));

vi.mock('../../../../lib/rag/retrieval/router.js', () => ({
  classifyQuery: mocks.classifyQuery,
}));

vi.mock('../../../../lib/rag/retrieval/hybrid.js', () => ({
  hybridSearch: mocks.hybridSearch,
}));

vi.mock('../../../../lib/rag/llm/index.js', () => ({
  generateAnswerStream: mocks.generateAnswerStream,
  generateAnswerStreamFromContext: mocks.generateAnswerStreamFromContext,
  buildSources: mocks.buildSources,
  buildContextText: mocks.buildContextText,
}));

vi.mock('../../../../lib/rag/code-fetch.js', () => ({
  codeFetchStage: mocks.codeFetchStage,
}));

vi.mock('../../../../lib/rag/metrics/index.js', () => ({
  ServerMetricsRecorder: mocks.ServerMetricsRecorder,
  categorizeError: mocks.categorizeError,
  logStreamMetrics: mocks.logStreamMetrics,
}));

import handler from '../../../../api/rag/resume.js';

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

describe('api/rag/resume handler integration', () => {
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
    mocks.buildSources.mockReturnValue([
      { type: 'issue', title: 'Source', url: 'https://github.com/owner/repo/issues/1' },
    ]);
    mocks.buildContextText.mockReturnValue('rebuilt context');
    mocks.generateAnswerStream.mockReturnValue(createAsyncGenerator(['continued']));
    mocks.generateAnswerStreamFromContext.mockReturnValue(createAsyncGenerator(['continued']));
    mocks.codeFetchStage.mockResolvedValue({
      codeContext: '[Live source code]\\n\\n--- src/retry.ts ---\\nexport function retryHandler() {}',
      fetchedFiles: ['src/retry.ts'],
      failedFiles: [],
      usedSummaryOnlyFallback: false,
    });
  });

  it('resumes from stored snapshot context without re-running retrieval', async () => {
    mocks.getStreamSession.mockResolvedValue({
      requestId: 'req_123',
      login: 'alice',
      repo: 'owner/repo',
      question: 'Where is retryHandler defined?',
      lastSeq: 3,
      partialAnswer: 'partial ',
      contextText: 'stored context',
      contextPrefix: 'stored prefix',
      sources: [{ type: 'issue', title: 'Source', url: 'https://github.com/owner/repo/issues/1' }],
    });

    const req = createMockReq({ requestId: 'req_123', lastSeq: 3 });
    const res = createMockRes();

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(mocks.generateAnswerStreamFromContext).toHaveBeenCalledWith(
      'Where is retryHandler defined?',
      'owner/repo',
      'stored context',
      'stored prefix',
      'partial ',
    );
    expect(mocks.hybridSearch).not.toHaveBeenCalled();
    expect(res.writes[0]).toContain('"resume":true');
    expect(res.writes.some((chunk) => chunk.includes('"type":"delta","seq":4,"content":"continued"'))).toBe(true);
    expect(mocks.deleteStreamSession).toHaveBeenCalledWith('req_123');
  });

  it('re-runs retrieval when the session has no stored snapshot', async () => {
    mocks.getStreamSession.mockResolvedValue({
      requestId: 'req_123',
      login: 'alice',
      repo: 'owner/repo',
      question: 'Where is retryHandler defined?',
      lastSeq: 1,
      partialAnswer: 'partial ',
    });
    mocks.countRepoChunks.mockResolvedValue(5);
    mocks.classifyQuery.mockReturnValue({ category: 'code', typeFilter: ['code_summary'] });
    mocks.hybridSearch.mockResolvedValue([
      {
        chunk: {
          id: 'owner/repo:code:src/retry.ts',
          content: 'summary',
          metadata: {
            repo: 'owner/repo',
            type: 'code_summary',
            title: 'src/retry.ts',
            githubUrl: 'https://github.com/owner/repo/blob/main/src/retry.ts',
          },
        },
        score: 1,
      },
    ]);

    const req = createMockReq({ requestId: 'req_123', lastSeq: 1 });
    const res = createMockRes();

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(mocks.classifyQuery).toHaveBeenCalledWith('Where is retryHandler defined?');
    expect(mocks.hybridSearch).toHaveBeenCalledWith(
      'Where is retryHandler defined?',
      'owner/repo',
      8,
      ['code_summary'],
      'code',
    );
    expect(mocks.generateAnswerStream).toHaveBeenCalledTimes(1);
    expect(mocks.generateAnswerStreamFromContext).not.toHaveBeenCalled();
    expect(mocks.codeFetchStage).toHaveBeenCalledTimes(1);
    expect(mocks.generateAnswerStream.mock.calls[0][3]).toContain('[Live source code]');
    expect(mocks.setStreamSessionSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 'req_123',
      contextText: 'rebuilt context',
      contextPrefix: expect.stringContaining('[Live source code]'),
    }));
  });

  it('returns 404 when the requested stream session is missing', async () => {
    mocks.getStreamSession.mockResolvedValue(null);

    const req = createMockReq({ requestId: 'req_missing', lastSeq: 0 });
    const res = createMockRes();

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Stream session not found or expired' });
  });

  it('allows snapshot-backed resume even when the GitHub token is temporarily unavailable', async () => {
    mocks.authenticateRequest.mockResolvedValue({
      authenticated: true,
      login: 'alice',
      token: null,
    });
    mocks.getStreamSession.mockResolvedValue({
      requestId: 'req_123',
      login: 'alice',
      repo: 'owner/repo',
      question: 'Where is retryHandler defined?',
      lastSeq: 2,
      partialAnswer: 'partial ',
      contextText: 'stored context',
      contextPrefix: 'stored prefix',
      sources: [{ type: 'issue', title: 'Source', url: 'https://github.com/owner/repo/issues/1' }],
    });

    const req = createMockReq({ requestId: 'req_123', lastSeq: 2 });
    const res = createMockRes();

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(mocks.generateAnswerStreamFromContext).toHaveBeenCalledTimes(1);
    expect(mocks.codeFetchStage).not.toHaveBeenCalled();
  });
});
