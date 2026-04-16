import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as auth from '../../../../lib/rag/auth/index.js';
import * as storage from '../../../../lib/rag/storage/index.js';
import shareHandler from '../../../../api/rag/share.js';

type MockReq = {
  method?: string;
  body?: Record<string, unknown>;
};

type MockRes = {
  statusCode: number;
  body: unknown;
  status: (code: number) => MockRes;
  json: (payload: unknown) => MockRes;
};

function createMockRes(): MockRes {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

describe('POST /api/rag/share', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    vi.restoreAllMocks();
    originalEnv = { ...process.env };
    process.env.UPSTASH_REDIS_REST_URL = 'https://redis.test';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'token';
    delete process.env.RAG_ALLOWED_URL_ORIGIN_PATTERNS;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('sanitizes unsafe source URLs before persistence', async () => {
    vi.spyOn(auth, 'authenticateRequest').mockResolvedValue({
      authenticated: true,
      login: 'alice',
      token: 'token',
    });
    const setShareEntry = vi.spyOn(storage, 'setShareEntry').mockResolvedValue();

    const req: MockReq = {
      method: 'POST',
      body: {
        repo: 'owner/repo',
        question: 'q',
        answer: 'a',
        sources: [
          { type: 'issue', title: 'safe', url: 'https://github.com/owner/repo/issues/1' },
          { type: 'issue', title: 'unsafe', url: 'javascript:alert(1)' },
        ],
      },
    };
    const res = createMockRes();

    await shareHandler(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(setShareEntry).toHaveBeenCalledTimes(1);

    const payload = setShareEntry.mock.calls[0][0];
    expect(payload.sources).toHaveLength(2);
    expect(payload.sources[0].url).toBe('https://github.com/owner/repo/issues/1');
    expect(payload.sources[1].url).toBe('');
  });

  it('drops invalid source items and unexpected fields from persistence payload', async () => {
    vi.spyOn(auth, 'authenticateRequest').mockResolvedValue({
      authenticated: true,
      login: 'alice',
      token: 'token',
    });
    const setShareEntry = vi.spyOn(storage, 'setShareEntry').mockResolvedValue();

    const req: MockReq = {
      method: 'POST',
      body: {
        repo: 'owner/repo',
        question: 'q',
        answer: 'a',
        sources: [
          {
            type: 'issue',
            title: 'safe',
            url: 'https://github.com/owner/repo/issues/1',
            extra: 'should-not-persist',
          },
          {
            type: 'not-valid',
            title: 'bad',
            url: 'https://github.com/owner/repo/issues/2',
          },
        ],
      },
    };
    const res = createMockRes();

    await shareHandler(req as never, res as never);

    expect(res.statusCode).toBe(200);
    const payload = setShareEntry.mock.calls[0][0];
    expect(payload.sources).toHaveLength(1);
    expect(payload.sources[0]).toEqual({
      type: 'issue',
      title: 'safe',
      url: 'https://github.com/owner/repo/issues/1',
    });
  });
});
