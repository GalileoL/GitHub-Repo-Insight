import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchRepoData } from '../../../../../lib/rag/github/fetchers.js';

function makeHeaders(values: Record<string, string> = {}) {
  return {
    get(name: string) {
      return values[name.toLowerCase()] ?? values[name] ?? null;
    },
  };
}

describe('fetchRepoData', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('uses one GraphQL request and merges duplicate repository data', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://api.github.com/graphql');
      expect(init?.method).toBe('POST');

      const body = JSON.parse(String(init?.body ?? '{}')) as { query: string; variables: { owner: string; name: string } };
      expect(body.variables).toEqual({ owner: 'owner', name: 'repo' });
      expect(body.query).toContain('issuesCreated');
      expect(body.query).toContain('pullsUpdated');
      expect(body.query).toContain('HEAD:README.md');

      return {
        ok: true,
        status: 200,
        headers: makeHeaders(),
        json: async () => ({
          data: {
            repository: {
              readme: { text: '# README' },
              issuesCreated: {
                nodes: [
                  {
                    number: 1,
                    title: 'First issue',
                    body: 'Issue body',
                    state: 'OPEN',
                    url: 'https://github.com/owner/repo/issues/1',
                    createdAt: '2024-03-01T00:00:00Z',
                    author: { login: 'alice' },
                    labels: { nodes: [{ name: 'bug' }] },
                  },
                ],
              },
              issuesUpdated: {
                nodes: [
                  {
                    number: 1,
                    title: 'First issue',
                    body: 'Issue body',
                    state: 'OPEN',
                    url: 'https://github.com/owner/repo/issues/1',
                    createdAt: '2024-03-01T00:00:00Z',
                    author: { login: 'alice' },
                    labels: { nodes: [{ name: 'bug' }] },
                  },
                  {
                    number: 2,
                    title: 'Second issue',
                    body: null,
                    state: 'CLOSED',
                    url: 'https://github.com/owner/repo/issues/2',
                    createdAt: '2024-03-02T00:00:00Z',
                    author: { login: null },
                    labels: { nodes: null },
                  },
                ],
              },
              pullsCreated: {
                nodes: [
                  {
                    number: 10,
                    title: 'First PR',
                    body: 'PR body',
                    state: 'MERGED',
                    mergedAt: '2024-03-10T00:00:00Z',
                    url: 'https://github.com/owner/repo/pull/10',
                    createdAt: '2024-03-03T00:00:00Z',
                    author: { login: 'bob' },
                    labels: { nodes: [{ name: 'enhancement' }] },
                    files: { nodes: [{ path: 'src/a.ts' }] },
                  },
                ],
              },
              pullsUpdated: {
                nodes: [
                  {
                    number: 10,
                    title: 'First PR',
                    body: 'PR body',
                    state: 'MERGED',
                    mergedAt: '2024-03-10T00:00:00Z',
                    url: 'https://github.com/owner/repo/pull/10',
                    createdAt: '2024-03-03T00:00:00Z',
                    author: { login: 'bob' },
                    labels: { nodes: [{ name: 'enhancement' }] },
                    files: { nodes: [{ path: 'src/b.ts' }] },
                  },
                ],
              },
              releases: {
                nodes: [
                  {
                    tagName: 'v1.0.0',
                    name: 'Release 1',
                    body: 'Release notes',
                    url: 'https://github.com/owner/repo/releases/tag/v1.0.0',
                    publishedAt: '2024-03-15T00:00:00Z',
                    isPrerelease: false,
                  },
                ],
              },
              defaultBranchRef: {
                target: {
                  history: {
                    nodes: [
                      {
                        oid: 'abc123',
                        message: 'Initial commit',
                        url: 'https://github.com/owner/repo/commit/abc123',
                        committedDate: '2024-03-20T00:00:00Z',
                        author: { name: 'alice', date: '2024-03-20T00:00:00Z' },
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

    const result = await fetchRepoData('owner/repo', 'token-123');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.readme).toBe('# README');
    expect(result.issues).toHaveLength(2);
    expect(result.issues[0]?.number).toBe(1);
    expect(result.pulls).toHaveLength(1);
    expect(result.pulls[0]?.changedFiles).toEqual(['src/a.ts', 'src/b.ts']);
    expect(result.releases).toHaveLength(1);
    expect(result.commits).toHaveLength(1);
  });
});
