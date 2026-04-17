import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchRepoData,
  prioritizeFetchedSourceFiles,
  prioritizeSourceFilePaths,
} from '../../../../../lib/rag/github/fetchers.js';

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

  it('rejects invalid repo format with extra segments', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await expect(fetchRepoData('owner/repo/extra', 'token-123')).rejects.toThrow(
      'Invalid repo format: owner/repo/extra',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('prioritizeSourceFilePaths', () => {
  const rankingData = {
    commits: [
      {
        sha: 'c1',
        message: 'refactor retry handler in src/auth/retry.ts',
        html_url: 'https://github.com/owner/repo/commit/c1',
        date: '2024-03-20T00:00:00Z',
        author: 'alice',
      },
      {
        sha: 'c2',
        message: 'retry cleanup and refresh flow',
        html_url: 'https://github.com/owner/repo/commit/c2',
        date: '2024-03-21T00:00:00Z',
        author: 'bob',
      },
    ],
    pulls: [
      {
        number: 1,
        title: 'Retry improvements',
        body: null,
        state: 'MERGED',
        merged_at: '2024-03-22T00:00:00Z',
        html_url: 'https://github.com/owner/repo/pull/1',
        created_at: '2024-03-18T00:00:00Z',
        user: 'alice',
        labels: [],
        changedFiles: ['src/auth/retry.ts', 'src/App.tsx'],
      },
    ],
  };

  it('keeps guaranteed entry paths inside the capped selection', () => {
    const ranked = prioritizeSourceFilePaths([
      { path: 'src/feature/z.ts', size: 200 },
      { path: 'api/rag/ask.ts', size: 150 },
      { path: 'src/index.ts', size: 180 },
      { path: 'src/App.tsx', size: 400 },
      { path: 'lib/rag/index.ts', size: 120 },
    ], rankingData, 2);

    expect(ranked).toHaveLength(2);
    expect(ranked.map((item) => item.path)).toContain('api/rag/ask.ts');
    expect(ranked.every((item) => (
      item.path === 'api/rag/ask.ts'
      || item.path === 'src/index.ts'
      || item.path === 'src/App.tsx'
      || item.path === 'lib/rag/index.ts'
    ))).toBe(true);
  });

  it('prefers hotter files over colder ones in the competitive tier', () => {
    const ranked = prioritizeSourceFilePaths([
      { path: 'src/auth/retry.ts', size: 500 },
      { path: 'src/ui/theme.ts', size: 100 },
      { path: 'src/cache/store.ts', size: 110 },
    ], rankingData, 2);

    expect(ranked[0]?.path).toBe('src/auth/retry.ts');
  });

  it('does not over-rank generic basenames from broad commit wording', () => {
    const ranked = prioritizeSourceFilePaths([
      { path: 'src/auth.ts', size: 600 },
      { path: 'src/retry-flow.ts', size: 400 },
    ], {
      commits: [
        {
          sha: 'c3',
          message: 'auth cleanup and auth token fixes',
          html_url: 'https://github.com/owner/repo/commit/c3',
          date: '2024-03-22T00:00:00Z',
          author: 'alice',
        },
      ],
      pulls: [],
    }, 2);

    expect(ranked.map((item) => item.path)).toEqual(['src/retry-flow.ts', 'src/auth.ts']);
  });

  it('rebalances guaranteed overflow by entry priority instead of alphabetical order', () => {
    const ranked = prioritizeSourceFilePaths([
      { path: 'api/z-last.ts', size: 140 },
      { path: 'api/a-first.ts', size: 160 },
      { path: 'src/index.ts', size: 120 },
    ], {
      commits: [
        {
          sha: 'c4',
          message: 'touch api/z-last.ts',
          html_url: 'https://github.com/owner/repo/commit/c4',
          date: '2024-03-22T00:00:00Z',
          author: 'alice',
        },
      ],
      pulls: [],
    }, 2);

    expect(ranked.map((item) => item.path)).toEqual(['api/z-last.ts', 'api/a-first.ts']);
  });
});

describe('prioritizeFetchedSourceFiles', () => {
  const rankingData = {
    commits: [],
    pulls: [
      {
        number: 1,
        title: 'Expose router helpers',
        body: null,
        state: 'MERGED',
        merged_at: '2024-03-22T00:00:00Z',
        html_url: 'https://github.com/owner/repo/pull/1',
        created_at: '2024-03-18T00:00:00Z',
        user: 'alice',
        labels: [],
        changedFiles: ['src/router.ts'],
      },
    ],
  };

  it('uses export-rich files as a secondary ordering signal after fetch', () => {
    const ranked = prioritizeFetchedSourceFiles([
      {
        path: 'src/router.ts',
        size: 300,
        content: 'export function classifyQuery() {}\nexport const DEFAULTS = {}',
      },
      {
        path: 'src/theme.ts',
        size: 300,
        content: 'const palette = {}',
      },
    ], rankingData);

    expect(ranked[0]?.path).toBe('src/router.ts');
  });
});
