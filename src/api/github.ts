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

  getIssues: (owner: string, repo: string, params?: Record<string, string>) =>
    githubFetch<import('../types/github').GitHubIssue[]>(`/repos/${owner}/${repo}/issues`, {
      params: { state: 'all', per_page: '100', sort: 'created', direction: 'desc', ...params },
    }),

  getIssuesPaginated: async (owner: string, repo: string, pages: number = 5) => {
    type Issue = import('../types/github').GitHubIssue;
    const allIssues: Issue[] = [];
    for (let page = 1; page <= pages; page++) {
      const issues = await githubFetch<Issue[]>(`/repos/${owner}/${repo}/issues`, {
        params: { state: 'all', per_page: '100', sort: 'created', direction: 'desc', page: String(page) },
      });
      allIssues.push(...issues);
      if (issues.length < 100) break; // No more pages
    }
    return allIssues;
  },
};
