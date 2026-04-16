import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSignedPayload } from '../../../../../lib/rag/auth/cookies.js';
import { authenticateRequest, getSessionUser, _resetRedis } from '../../../../../lib/rag/auth/index.js';

type MockReq = {
  headers: {
    cookie?: string;
    authorization?: string;
  };
};

type MockRes = {
  headers: Record<string, string | string[]>;
  setHeader: (name: string, value: string | string[]) => void;
  getHeader: (name: string) => string | string[] | undefined;
};

function createMockRes(): MockRes {
  return {
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    getHeader(name) {
      return this.headers[name];
    },
  };
}

function buildSessionCookie(payload: Record<string, unknown>): string {
  const signed = createSignedPayload(payload);
  return `gh_app_session=${encodeURIComponent(signed)}`;
}

function mockFetchResponse(options: {
  ok: boolean;
  status: number;
  body?: unknown;
}): Response {
  const bodyStr = JSON.stringify(options.body ?? {});
  return {
    ok: options.ok,
    status: options.status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => options.body ?? {},
    text: async () => bodyStr,
  } as Response;
}

/** Build a mock pipeline response matching the number of commands in the request body. */
function mockRedisPipeline(_init?: RequestInit): Response {
  let cmdCount = 1;
  try {
    const body = JSON.parse(String(_init?.body ?? '[]')) as unknown[];
    cmdCount = body.length;
  } catch { /* fallback to 1 */ }
  const results = Array.from({ length: cmdCount }, () => ({ result: null }));
  const bodyStr = JSON.stringify(results);
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => results,
    text: async () => bodyStr,
  } as Response;
}

describe('auth session hardening', () => {
  let originalFetch: typeof globalThis.fetch;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalEnv = { ...process.env };
    process.env.AUTH_SESSION_SECRET = 'test-secret';
    process.env.GITHUB_APP_CLIENT_ID = 'client-id';
    process.env.GITHUB_APP_CLIENT_SECRET = 'client-secret';
    process.env.UPSTASH_REDIS_REST_URL = 'https://fake-redis.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'fake-token';
    _resetRedis();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-14T12:00:00.000Z'));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = originalEnv;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('rejects signed session payloads missing issuedAt', () => {
    const req: MockReq = {
      headers: {
        cookie: buildSessionCookie({
          token: 'token-1',
          login: 'octocat',
          userId: 1,
          avatarUrl: 'https://example.com/avatar.png',
        }),
      },
    };

    const user = getSessionUser(req as never);
    expect(user).toBeNull();
  });

  it('falls back to current token when refresh fails but token is not expired', async () => {
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/pipeline')) {
        return mockRedisPipeline(init);
      }
      if (url.includes('/login/oauth/access_token')) {
        return mockFetchResponse({ ok: false, status: 500 });
      }

      if (url.includes('/api.github.com/user')) {
        return mockFetchResponse({ ok: true, status: 200, body: { login: 'octocat' } });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const req: MockReq = {
      headers: {
        cookie: buildSessionCookie({
          token: 'token-active',
          refreshToken: 'refresh-token',
          tokenExpiresAt: Date.now() + 30_000,
          refreshTokenExpiresAt: Date.now() + 86_400_000,
          login: 'octocat',
          userId: 1,
          avatarUrl: 'https://example.com/avatar.png',
          issuedAt: Date.now(),
        }),
      },
    };
    const res = createMockRes();

    const result = await authenticateRequest(req as never, res as never);

    expect(result.authenticated).toBe(true);
    expect(result.token).toBe('token-active');
    expect(res.getHeader('Set-Cookie')).toBeUndefined();
  });

  it('clears session when refresh fails and token is already expired', async () => {
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/pipeline')) {
        return mockRedisPipeline(init);
      }
      if (url.includes('/login/oauth/access_token')) {
        return mockFetchResponse({ ok: false, status: 500 });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const req: MockReq = {
      headers: {
        cookie: buildSessionCookie({
          token: 'token-expired',
          refreshToken: 'refresh-token',
          tokenExpiresAt: Date.now() - 1_000,
          refreshTokenExpiresAt: Date.now() + 86_400_000,
          login: 'octocat',
          userId: 1,
          avatarUrl: 'https://example.com/avatar.png',
          issuedAt: Date.now(),
        }),
      },
    };
    const res = createMockRes();

    const result = await authenticateRequest(req as never, res as never);

    expect(result.authenticated).toBe(false);
    expect(result.error).toContain('Authentication required');
    const setCookie = String(res.getHeader('Set-Cookie') ?? '');
    expect(setCookie).toContain('gh_app_session=');
    expect(setCookie).toContain('Max-Age=0');
  });
});
