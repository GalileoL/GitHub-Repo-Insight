import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/store/auth', () => ({
  useAuthStore: {
    getState: () => ({ token: 'token-123' }),
  },
}));

import { githubApi } from '../../../../src/api/github.js';

function makeHeaders(values: Record<string, string> = {}) {
  return {
    get(name: string) {
      return values[name.toLowerCase()] ?? values[name] ?? null;
    },
  };
}

describe('githubFetch caching', () => {
  let originalFetch: typeof globalThis.fetch;
  let originalLocalStorage: unknown;
  let storage: Record<string, string>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalLocalStorage = globalThis.localStorage;
    storage = {};
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => (key in storage ? storage[key] : null),
        setItem: (key: string, value: string) => {
          storage[key] = value;
        },
        removeItem: (key: string) => {
          delete storage[key];
        },
        clear: () => {
          storage = {};
        },
        key: (index: number) => Object.keys(storage)[index] ?? null,
        get length() {
          return Object.keys(storage).length;
        },
      },
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalLocalStorage) {
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: originalLocalStorage,
      });
    } else {
      Reflect.deleteProperty(globalThis, 'localStorage');
    }
    vi.clearAllMocks();
  });

  it('sends If-None-Match and reuses cached JSON on 304', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = Object.fromEntries(new Headers(init?.headers as HeadersInit).entries());

      if (fetchMock.mock.calls.length === 1) {
        expect(headers.authorization).toBe('Bearer token-123');
        expect(headers.accept).toBe('application/vnd.github+json');
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
        } as Response;
      }

      expect(headers['if-none-match']).toBe('"etag-1"');
      return {
        ok: false,
        status: 304,
        headers: makeHeaders({
          etag: '"etag-1"',
          'x-ratelimit-limit': '60',
          'x-ratelimit-remaining': '58',
          'x-ratelimit-reset': '1700000000',
          'x-ratelimit-used': '2',
        }),
        json: async () => ({}),
      } as Response;
    });

    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const first = await githubApi.getRepo('owner', 'repo');
    const second = await githubApi.getRepo('owner', 'repo');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(first).toEqual({ id: 1, full_name: 'owner/repo' });
    expect(second).toEqual({ id: 1, full_name: 'owner/repo' });
  });
});
