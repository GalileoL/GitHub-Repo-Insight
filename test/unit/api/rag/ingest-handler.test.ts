import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  checkIngestRateLimit: vi.fn(),
  fetchRepoData: vi.fn(),
  fetchRepoSourceFiles: vi.fn(),
  chunkRepoData: vi.fn(),
  embedTexts: vi.fn(),
  prewarmEmbeddings: vi.fn(),
  upsertChunks: vi.fn(),
  deleteRepoChunks: vi.fn(),
  setRepoChunkCount: vi.fn(),
  normalizeRepo: vi.fn((repo: string) => repo.toLowerCase()),
  incrementAlertStreak: vi.fn(),
  resetAlertStreak: vi.fn(),
  checkAndFireStreakAlert: vi.fn(),
}));

vi.mock('../../../../lib/rag/auth/index.js', () => ({
  authenticateRequest: mocks.authenticateRequest,
  checkIngestRateLimit: mocks.checkIngestRateLimit,
}));

vi.mock('../../../../lib/rag/github/fetchers.js', () => ({
  fetchRepoData: mocks.fetchRepoData,
  fetchRepoSourceFiles: mocks.fetchRepoSourceFiles,
}));

vi.mock('../../../../lib/rag/chunking/index.js', () => ({
  chunkRepoData: mocks.chunkRepoData,
}));

vi.mock('../../../../lib/rag/embeddings/index.js', () => ({
  embedTexts: mocks.embedTexts,
}));

vi.mock('../../../../lib/rag/llm/index.js', () => ({
  prewarmEmbeddings: mocks.prewarmEmbeddings,
}));

vi.mock('../../../../lib/rag/storage/index.js', () => ({
  upsertChunks: mocks.upsertChunks,
  deleteRepoChunks: mocks.deleteRepoChunks,
  setRepoChunkCount: mocks.setRepoChunkCount,
  normalizeRepo: mocks.normalizeRepo,
}));

vi.mock('../../../../lib/admin/alert-manager.js', () => ({
  incrementAlertStreak: mocks.incrementAlertStreak,
  resetAlertStreak: mocks.resetAlertStreak,
  checkAndFireStreakAlert: mocks.checkAndFireStreakAlert,
}));

import handler from '../../../../api/rag/ingest.js';

type MockReq = {
  method?: string;
  body?: Record<string, unknown>;
};

type MockRes = {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
  status: (code: number) => MockRes;
  json: (payload: unknown) => MockRes;
  setHeader: (name: string, value: string) => void;
};

function createMockRes(): MockRes {
  return {
    statusCode: 200,
    body: undefined,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
  };
}

describe('api/rag/ingest handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateRequest.mockResolvedValue({
      authenticated: true,
      login: 'alice',
      token: 'gh-token',
    });
    mocks.checkIngestRateLimit.mockResolvedValue({
      allowed: true,
      limit: 5,
      remaining: 4,
    });
    mocks.fetchRepoData.mockResolvedValue({
      readme: 'README',
      issues: [],
      pulls: [],
      releases: [],
      commits: [],
    });
    mocks.incrementAlertStreak.mockResolvedValue(undefined);
    mocks.checkAndFireStreakAlert.mockResolvedValue(undefined);
    mocks.resetAlertStreak.mockResolvedValue(undefined);
  });

  it('fails before destructive reindex when code summary source fetch fails', async () => {
    mocks.fetchRepoSourceFiles.mockRejectedValue(new Error('source fetch failed'));

    const req: MockReq = {
      method: 'POST',
      body: { repo: 'Owner/Repo' },
    };
    const res = createMockRes();

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({
      status: 'error',
      codeSummaryFailed: true,
      chunksIndexed: 0,
    });
    expect(mocks.deleteRepoChunks).not.toHaveBeenCalled();
    expect(mocks.upsertChunks).not.toHaveBeenCalled();
    expect(mocks.chunkRepoData).not.toHaveBeenCalled();
  });
});
