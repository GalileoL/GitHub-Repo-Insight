import { useAuthStore } from '../store/auth';
import { GITHUB_API_BASE } from '../constants';
import type { RateLimit } from '../types/github';

let latestRateLimit: RateLimit | null = null;

export function getRateLimit(): RateLimit | null {
  return latestRateLimit;
}

function updateRateLimit(headers: Headers): void {
  const limit = headers.get('x-ratelimit-limit');
  const remaining = headers.get('x-ratelimit-remaining');
  const reset = headers.get('x-ratelimit-reset');
  const used = headers.get('x-ratelimit-used');

  if (limit && remaining && reset && used) {
    latestRateLimit = {
      limit: parseInt(limit, 10),
      remaining: parseInt(remaining, 10),
      reset: parseInt(reset, 10),
      used: parseInt(used, 10),
    };
  }
}

export class GitHubApiError extends Error {
  status: number;
  isRateLimit: boolean;

  constructor(status: number, message: string, isRateLimit: boolean = false) {
    super(message);
    this.name = 'GitHubApiError';
    this.status = status;
    this.isRateLimit = isRateLimit;
  }
}

export async function githubFetch<T>(
  endpoint: string,
  options?: RequestInit & { params?: Record<string, string> },
): Promise<T> {
  const token = useAuthStore.getState().token;
  const url = new URL(`${GITHUB_API_BASE}${endpoint}`);

  if (options?.params) {
    Object.entries(options.params).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
  }

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const response = await fetch(url.toString(), {
    ...options,
    headers: { ...headers, ...options?.headers },
  });

  updateRateLimit(response.headers);

  if (!response.ok) {
    const isRateLimit = response.status === 403 || response.status === 429;
    const body = await response.json().catch(() => ({}));
    throw new GitHubApiError(
      response.status,
      body.message || `GitHub API error: ${response.status}`,
      isRateLimit,
    );
  }

  return response.json();
}

/**
 * Fetch with retry for GitHub stats endpoints that return 202 while computing.
 * Retries up to 4 times with increasing delays (1s, 2s, 3s, 4s).
 */
async function githubFetchWithRetry<T>(
  endpoint: string,
  options?: RequestInit & { params?: Record<string, string> },
  maxRetries: number = 4,
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const token = useAuthStore.getState().token;
    const url = new URL(`${GITHUB_API_BASE}${endpoint}`);

    if (options?.params) {
      Object.entries(options.params).forEach(([key, value]) => {
        url.searchParams.set(key, value);
      });
    }

    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };

    const response = await fetch(url.toString(), {
      ...options,
      headers: { ...headers, ...options?.headers },
    });

    updateRateLimit(response.headers);

    if (!response.ok) {
      const isRateLimit = response.status === 403 || response.status === 429;
      const body = await response.json().catch(() => ({}));
      throw new GitHubApiError(
        response.status,
        body.message || `GitHub API error: ${response.status}`,
        isRateLimit,
      );
    }

    // GitHub stats endpoints return 202 while computing — retry after a delay
    if (response.status === 202 && attempt < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 1000));
      continue;
    }

    if (response.status === 202) {
      return [] as T;
    }

    return response.json();
  }

  return [] as T;
}

export const githubApi = {
  getRepo: (owner: string, repo: string) =>
    githubFetch<import('../types/github').GitHubRepo>(`/repos/${owner}/${repo}`),

  getLanguages: (owner: string, repo: string) =>
    githubFetch<import('../types/github').GitHubLanguages>(`/repos/${owner}/${repo}/languages`),

  getContributors: (owner: string, repo: string) =>
    githubFetch<import('../types/github').GitHubContributor[]>(`/repos/${owner}/${repo}/contributors`, {
      params: { per_page: '30' },
    }),

  getCommitActivity: (owner: string, repo: string) =>
    githubFetchWithRetry<import('../types/github').GitHubCommitActivity[]>(`/repos/${owner}/${repo}/stats/commit_activity`),

  getReleases: (owner: string, repo: string) =>
    githubFetch<import('../types/github').GitHubRelease[]>(`/repos/${owner}/${repo}/releases`, {
      params: { per_page: '20' },
    }),

  getReleasesPage: (owner: string, repo: string, page: number) =>
    githubFetch<import('../types/github').GitHubRelease[]>(`/repos/${owner}/${repo}/releases`, {
      params: { per_page: '20', page: String(page) },
    }),

  getIssues: (owner: string, repo: string, params?: Record<string, string>) =>
    githubFetch<import('../types/github').GitHubIssue[]>(`/repos/${owner}/${repo}/issues`, {
      params: { state: 'all', per_page: '100', sort: 'created', direction: 'desc', ...params },
    }),

  getMonthlyIssuePrCounts: async (owner: string, repo: string, months: number = 12) => {
    type SearchResult = { total_count: number };
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');

    const monthRanges = Array.from({ length: months }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (months - 1 - i), 1);
      const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      return {
        key: `${d.getFullYear()}-${pad(d.getMonth() + 1)}`,
        start: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`,
        end: `${lastDay.getFullYear()}-${pad(lastDay.getMonth() + 1)}-${pad(lastDay.getDate())}`,
      };
    });

    // Fetch 2 months per batch (4 requests) with delays to stay within
    // the Search API rate limit (30 req/min authenticated, 10 unauthenticated)
    const batchSize = 2;
    const allResults: Array<{ month: string; issues: number; pullRequests: number }> = [];

    for (let i = 0; i < monthRanges.length; i += batchSize) {
      if (i > 0) await new Promise((r) => setTimeout(r, 2500));
      const batch = monthRanges.slice(i, i + batchSize);
      const promises = batch.flatMap((m) => [
        githubFetch<SearchResult>('/search/issues', {
          params: { q: `repo:${owner}/${repo} is:issue created:${m.start}..${m.end}`, per_page: '1' },
        }),
        githubFetch<SearchResult>('/search/issues', {
          params: { q: `repo:${owner}/${repo} is:pr created:${m.start}..${m.end}`, per_page: '1' },
        }),
      ]);
      const results = await Promise.all(promises);
      batch.forEach((m, idx) => {
        allResults.push({
          month: m.key,
          issues: results[idx * 2].total_count,
          pullRequests: results[idx * 2 + 1].total_count,
        });
      });
    }

    return allResults;
  },
};
