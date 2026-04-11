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

describe('githubApi.getRepoSnapshot', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('maps GraphQL repository snapshot to dashboard repo + languages', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { query: string; variables: Record<string, string> };
      expect(body.variables).toEqual({ owner: 'owner', name: 'repo' });
      expect(body.query).toContain('DashboardRepoSnapshot');
      expect(body.query).toContain('languages(first: 100');

      return {
        ok: true,
        status: 200,
        headers: makeHeaders({
          'x-ratelimit-limit': '5000',
          'x-ratelimit-remaining': '4999',
          'x-ratelimit-reset': '1700000000',
          'x-ratelimit-used': '1',
        }),
        json: async () => ({
          data: {
            repository: {
              databaseId: 123,
              name: 'repo',
              nameWithOwner: 'owner/repo',
              description: 'desc',
              url: 'https://github.com/owner/repo',
              stargazerCount: 10,
              forkCount: 2,
              watchers: { totalCount: 4 },
              issues: { totalCount: 6 },
              licenseInfo: { name: 'MIT License', spdxId: 'MIT' },
              createdAt: '2024-01-01T00:00:00Z',
              updatedAt: '2024-01-02T00:00:00Z',
              pushedAt: '2024-01-03T00:00:00Z',
              primaryLanguage: { name: 'TypeScript' },
              defaultBranchRef: { name: 'main' },
              owner: { login: 'owner', avatarUrl: 'https://example.com/avatar.png' },
              languages: {
                edges: [
                  { size: 1200, node: { name: 'TypeScript' } },
                  { size: 300, node: { name: 'CSS' } },
                ],
              },
            },
          },
        }),
      } as Response;
    });

    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const snapshot = await githubApi.getRepoSnapshot('owner', 'repo');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(snapshot.repo.full_name).toBe('owner/repo');
    expect(snapshot.repo.id).toBe(123);
    expect(snapshot.repo.owner.avatar_url).toBe('https://example.com/avatar.png');
    expect(snapshot.languages).toEqual({
      TypeScript: 1200,
      CSS: 300,
    });
  });
});
