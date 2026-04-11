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
    mockedGhFetch
      .mockResolvedValueOnce([
        {
          number: 1,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-03-10T12:00:00Z',
          merged_at: '2024-03-10T12:00:00Z',
          state: 'closed',
          user: { login: 'alice' },
        },
        {
          number: 2,
          created_at: '2024-03-03T00:00:00Z',
          updated_at: '2024-04-02T00:00:00Z',
          merged_at: '2024-04-02T00:00:00Z',
          state: 'closed',
          user: { login: 'bob' },
        },
      ])
      .mockResolvedValueOnce([]);

    const query = makeQuery({
      entity: 'pr',
      state: 'merged',
      dateRange: {
        since: '2024-03-01T00:00:00Z',
        until: '2024-03-31T23:59:59Z',
      },
    });

    const result = await executeAnalyticsQuery('owner/repo', query);

    expect(mockedGhFetch.mock.calls[0][0]).toContain('sort=updated');
    expect(result.data.count).toBe(1);
    expect(result.answer).toContain('Found **1** merged pull request');
  });

  it('filters closed issues by closed_at, not created_at', async () => {
    mockedGhFetch
      .mockResolvedValueOnce([
        {
          number: 11,
          created_at: '2024-01-05T00:00:00Z',
          updated_at: '2024-03-08T00:00:00Z',
          closed_at: '2024-03-08T00:00:00Z',
          state: 'closed',
          user: { login: 'alice' },
        },
        {
          number: 12,
          created_at: '2024-03-10T00:00:00Z',
          updated_at: '2024-04-01T00:00:00Z',
          closed_at: '2024-04-01T00:00:00Z',
          state: 'closed',
          user: { login: 'bob' },
        },
      ])
      .mockResolvedValueOnce([]);

    const query = makeQuery({
      entity: 'issue',
      state: 'closed',
      dateRange: {
        since: '2024-03-01T00:00:00Z',
        until: '2024-03-31T23:59:59Z',
      },
    });

    const result = await executeAnalyticsQuery('owner/repo', query);

    expect(mockedGhFetch.mock.calls[0][0]).toContain('sort=updated');
    expect(result.data.count).toBe(1);
    expect(result.answer).toContain('Found **1** closed issue');
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
});
