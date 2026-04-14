import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('maps GraphQL repository snapshot to dashboard repo + languages', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        path?: string;
        method?: string;
        query: string;
        variables: Record<string, string>;
      };
      expect(_url).toBe('/api/github');
      expect(body).toMatchObject({ path: '/graphql', method: 'POST' });
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

  it('aggregates contributors from GraphQL commit history', async () => {
    const fetchMock = vi.fn(async () => {
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
              defaultBranchRef: {
                target: {
                  history: {
                    nodes: [
                      {
                        author: {
                          name: 'Alice',
                          user: {
                            login: 'alice',
                            avatarUrl: 'https://example.com/a.png',
                            url: 'https://github.com/alice',
                          },
                        },
                      },
                      {
                        author: {
                          name: 'Alice',
                          user: {
                            login: 'alice',
                            avatarUrl: 'https://example.com/a.png',
                            url: 'https://github.com/alice',
                          },
                        },
                      },
                      {
                        author: {
                          name: 'NoUser',
                          user: null,
                        },
                      },
                      {
                        author: {
                          name: 'Bob',
                          user: {
                            login: 'bob',
                            avatarUrl: 'https://example.com/b.png',
                            url: 'https://github.com/bob',
                          },
                        },
                      },
                    ],
                  },
                },
              },
            },
          },
        }),
      } as Response;
    });

    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const contributors = await githubApi.getContributors('owner', 'repo');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(contributors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          login: 'alice',
          contributions: 2,
          html_url: 'https://github.com/alice',
        }),
        expect.objectContaining({
          login: 'bob',
          contributions: 1,
        }),
        expect.objectContaining({
          login: 'NoUser',
          html_url: '',
          contributions: 1,
        }),
      ]),
    );
  });

  it('fetches monthly issue/pr counts in one GraphQL request', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-15T00:00:00Z'));

    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        path?: string;
        method?: string;
        query: string;
        variables: Record<string, string>;
      };

      expect(_url).toBe('/api/github');
      expect(body.path).toBe('/graphql');
      expect(body.method).toBe('POST');
      expect(body.query).toContain('query MonthlyIssuePrCounts');
      expect(body.query).toContain('issue_');
      expect(body.query).toContain('pr_');
      expect(Object.keys(body.variables).length).toBe(6);

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
            issue_2026_01: { issueCount: 5 },
            pr_2026_01: { issueCount: 2 },
            issue_2026_02: { issueCount: 7 },
            pr_2026_02: { issueCount: 3 },
            issue_2026_03: { issueCount: 4 },
            pr_2026_03: { issueCount: 1 },
          },
        }),
      } as Response;
    });

    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const counts = await githubApi.getMonthlyIssuePrCounts('owner', 'repo', 3);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(counts).toEqual([
      { month: '2026-01', issues: 5, pullRequests: 2 },
      { month: '2026-02', issues: 7, pullRequests: 3 },
      { month: '2026-03', issues: 4, pullRequests: 1 },
    ]);

    vi.useRealTimers();
  });
});
