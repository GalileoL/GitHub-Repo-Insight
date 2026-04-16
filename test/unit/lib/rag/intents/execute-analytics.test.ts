import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnalyticsQuery } from '../../../../../lib/rag/intents/types.js';

vi.mock('../../../../../lib/rag/github/client.js', () => ({
  ghFetch: vi.fn(),
}));

import { ghFetch } from '../../../../../lib/rag/github/client.js';
import { executeAnalyticsQuery } from '../../../../../lib/rag/intents/execute-analytics.js';

const mockedGhFetch = vi.mocked(ghFetch);

function makeQuery(partial: Partial<AnalyticsQuery>): AnalyticsQuery {
  return {
    op: 'count',
    entity: 'pr',
    dateRange: null,
    state: 'all',
    originalQuestion: 'test',
    ...partial,
  };
}

describe('executeAnalyticsQuery', () => {
  beforeEach(() => {
    mockedGhFetch.mockReset();
  });

  it('filters merged PRs by merged_at, not created_at', async () => {
    mockedGhFetch.mockResolvedValueOnce({
      total_count: 1,
      incomplete_results: false,
    });

    const query = makeQuery({
      entity: 'pr',
      state: 'merged',
      dateRange: {
        since: '2024-03-01T00:00:00Z',
        until: '2024-03-31T23:59:59Z',
      },
    });

    const result = await executeAnalyticsQuery('owner/repo', query);

  const searchPath = decodeURIComponent(mockedGhFetch.mock.calls[0][0]);
  expect(searchPath).toContain('/search/issues?q=');
  expect(searchPath).toContain('is:pr');
  expect(searchPath).toContain('is:merged');
  expect(searchPath).toContain('merged:2024-03-01T00:00:00Z..2024-03-31T23:59:59Z');
    expect(result.data.count).toBe(1);
    expect(result.answer).toContain('Found **1** merged pull request');
  });

  it('filters closed issues by closed_at, not created_at', async () => {
    mockedGhFetch.mockResolvedValueOnce({
      total_count: 1,
      incomplete_results: false,
    });

    const query = makeQuery({
      entity: 'issue',
      state: 'closed',
      dateRange: {
        since: '2024-03-01T00:00:00Z',
        until: '2024-03-31T23:59:59Z',
      },
    });

    const result = await executeAnalyticsQuery('owner/repo', query);

  const searchPath = decodeURIComponent(mockedGhFetch.mock.calls[0][0]);
  expect(searchPath).toContain('/search/issues?q=');
  expect(searchPath).toContain('is:issue');
  expect(searchPath).toContain('is:closed');
  expect(searchPath).toContain('closed:2024-03-01T00:00:00Z..2024-03-31T23:59:59Z');
    expect(result.data.count).toBe(1);
    expect(result.answer).toContain('Found **1** closed issue');
  });

  it('marks count results as possibly incomplete when search reports incomplete_results', async () => {
    mockedGhFetch.mockResolvedValueOnce({
      total_count: 1547,
      incomplete_results: true,
    });

    const query = makeQuery({
      entity: 'issue',
      state: 'all',
      dateRange: {
        since: '2026-03-16T00:00:00Z',
        until: '2026-04-16T23:59:59Z',
      },
    });

    const result = await executeAnalyticsQuery('owner/repo', query);

    expect(result.data.count).toBe(1547);
    expect(result.data.truncated).toBe(true);
    expect(result.answer).toContain('GitHub Search API limits');
  });

  it('uses open-state issue/pr search qualifiers without date filters when dateRange is null', async () => {
    mockedGhFetch.mockResolvedValueOnce({
      total_count: 42,
      incomplete_results: false,
    });

    const query = makeQuery({
      entity: 'pr',
      state: 'open',
      dateRange: null,
    });

    const result = await executeAnalyticsQuery('owner/repo', query);

    const searchPath = decodeURIComponent(mockedGhFetch.mock.calls[0][0]);
    expect(searchPath).toContain('/search/issues?q=');
    expect(searchPath).toContain('repo:owner/repo');
    expect(searchPath).toContain('is:pr');
    expect(searchPath).toContain('is:open');
    expect(searchPath).not.toContain('created:');
    expect(searchPath).not.toContain('closed:');
    expect(searchPath).not.toContain('merged:');
    expect(result.data.count).toBe(42);
  });

  it('does not emit invalid commit state wording', async () => {
    mockedGhFetch
      .mockResolvedValueOnce([
        {
          sha: 'abc123',
          commit: {
            author: {
              name: 'alice',
              date: '2024-03-05T00:00:00Z',
            },
          },
        },
      ])
      .mockResolvedValueOnce([]);

    const query = makeQuery({
      entity: 'commit',
      state: 'closed',
    });

    const result = await executeAnalyticsQuery('owner/repo', query);

    expect(result.answer).toContain('Found **1** commit');
    expect(result.answer).not.toContain('closed commit');
  });

  it('uses pagination-limit wording when commit count hits MAX_PAGES', async () => {
    const batch = Array.from({ length: 100 }, (_, i) => ({
      sha: `sha-${i}`,
      commit: {
        author: {
          name: 'alice',
          date: '2024-03-05T00:00:00Z',
        },
      },
    }));

    for (let i = 0; i < 30; i++) {
      mockedGhFetch.mockResolvedValueOnce(batch);
    }
    mockedGhFetch.mockResolvedValueOnce([]);

    const query = makeQuery({
      entity: 'commit',
      state: 'all',
      dateRange: null,
    });

    const result = await executeAnalyticsQuery('owner/repo', query);

    expect(result.data.truncated).toBe(true);
    expect(result.answer).toContain('pagination limit');
  });
});
