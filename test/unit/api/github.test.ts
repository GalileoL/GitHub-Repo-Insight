import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';

import handler from '../../../api/github.js';

function makeHeaders(values: Record<string, string> = {}) {
  return {
    get(name: string) {
      return values[name.toLowerCase()] ?? values[name] ?? null;
    },
  };
}

type MockReq = {
  method?: string;
  query: Record<string, unknown>;
  body?: unknown;
  headers: Record<string, string | undefined>;
};

type MockRes = {
  statusCode: number;
  headers: Record<string, string | string[]>;
  body: unknown;
  ended: boolean;
  setHeader: (name: string, value: string | string[]) => void;
  status: (code: number) => MockRes;
  json: (payload: unknown) => MockRes;
  end: () => MockRes;
};

function createMockRes(): MockRes {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    ended: false,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      this.ended = true;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
}

function buildSignedSessionCookie(): string {
  const payload = {
    token: 'server-token-123',
    login: 'octocat',
    userId: 1,
    avatarUrl: 'https://example.com/avatar.png',
    issuedAt: Date.now(),
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = createHmac('sha256', 'test-secret').update(encoded).digest('base64url');
  return `gh_app_session=${encodeURIComponent(`${encoded}.${signature}`)}`;
}

describe('api/github proxy', () => {
  let originalFetch: typeof globalThis.fetch;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalEnv = { ...process.env };
    process.env.AUTH_SESSION_SECRET = 'test-secret';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  it('forwards GET requests to GitHub with the server token', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(_url).toBe('https://api.github.com/repos/owner/repo');
      const headers = Object.fromEntries(new Headers(init?.headers as HeadersInit).entries());
      expect(headers.authorization).toBe('Bearer server-token-123');
      expect(headers.accept).toBe('application/vnd.github+json');
      expect(headers['if-none-match']).toBe('"etag-1"');

      return {
        ok: true,
        status: 200,
        headers: makeHeaders({
          etag: '"etag-1"',
          'x-ratelimit-limit': '60',
          'x-ratelimit-remaining': '59',
          'x-ratelimit-reset': '1700000000',
          'x-ratelimit-used': '1',
        }),
        json: async () => ({ id: 1, full_name: 'owner/repo' }),
        text: async () => JSON.stringify({ id: 1, full_name: 'owner/repo' }),
      } as Response;
    });

    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const req: MockReq = {
      method: 'GET',
      query: { path: '/repos/owner/repo' },
      headers: {
        'if-none-match': '"etag-1"',
        cookie: buildSignedSessionCookie(),
      },
    };
    const res = createMockRes();

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ id: 1, full_name: 'owner/repo' });
    expect(res.headers.etag).toBe('"etag-1"');
  });

  it('forwards GraphQL POST requests with query and variables only', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(_url).toBe('https://api.github.com/graphql');
      const headers = Object.fromEntries(new Headers(init?.headers as HeadersInit).entries());
      expect(headers.authorization).toBe('Bearer server-token-123');
      expect(headers.accept).toBe('application/vnd.github+json');

      const body = JSON.parse(String(init?.body ?? '{}')) as { query: string; variables: Record<string, string> };
      expect(body.query).toContain('query DashboardRepoSnapshot');
      expect(body.variables).toEqual({ owner: 'owner', name: 'repo' });

      return {
        ok: true,
        status: 200,
        headers: makeHeaders({
          'x-ratelimit-limit': '5000',
          'x-ratelimit-remaining': '4999',
          'x-ratelimit-reset': '1700000000',
          'x-ratelimit-used': '1',
        }),
        json: async () => ({ data: { repository: { name: 'repo' } } }),
        text: async () => JSON.stringify({ data: { repository: { name: 'repo' } } }),
      } as Response;
    });

    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const req: MockReq = {
      method: 'POST',
      query: {},
      headers: {
        cookie: buildSignedSessionCookie(),
      },
      body: {
        path: '/graphql',
        method: 'POST',
        query: 'query DashboardRepoSnapshot($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { name } }',
        variables: { owner: 'owner', name: 'repo' },
      },
    };
    const res = createMockRes();

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ data: { repository: { name: 'repo' } } });
  });
});
