import { useAuthStore } from '../store/auth';
import { GITHUB_API_BASE } from '../constants';
import type { RateLimit } from '../types/github';

let latestRateLimit: RateLimit | null = null;

type CachedJson<T> = {
  etag: string;
  data: T;
};

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

interface DashboardRepoSnapshot {
  repo: import('../types/github').GitHubRepo;
  languages: import('../types/github').GitHubLanguages;
}

interface MonthlyIssuePrCount {
  month: string;
  issues: number;
  pullRequests: number;
}

const GITHUB_CACHE_PREFIX = 'github-api-cache:';

function getCacheKey(url: string): string {
  return `${GITHUB_CACHE_PREFIX}${url}`;
}

function readCachedJson<T>(url: string): CachedJson<T> | null {
  try {
    const raw = globalThis.localStorage?.getItem(getCacheKey(url));
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<CachedJson<T>>;
    if (typeof parsed.etag !== 'string' || parsed.etag.length === 0) return null;
    if (!('data' in parsed)) return null;

    return { etag: parsed.etag, data: parsed.data as T };
  } catch {
    return null;
  }
}

function writeCachedJson<T>(url: string, etag: string | null, data: T): void {
  if (!etag || !globalThis.localStorage) return;

  try {
    globalThis.localStorage.setItem(getCacheKey(url), JSON.stringify({ etag, data }));
  } catch {
    // Ignore quota and serialization failures.
  }
}

function buildGitHubHeaders(token?: string): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function normalizeHeaders(headers?: HeadersInit): Record<string, string> {
  if (!headers) return {};
  return Object.fromEntries(new Headers(headers).entries());
}

async function githubGraphql<T>(query: string, variables: Record<string, string>): Promise<T> {
  const token = useAuthStore.getState().token;
  const response = await fetch(`${GITHUB_API_BASE}/graphql`, {
    method: 'POST',
    headers: {
      ...buildGitHubHeaders(token ?? undefined),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });

  updateRateLimit(response.headers);

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const message = body.message || `GitHub GraphQL error: ${response.status}`;
    throw new GitHubApiError(response.status, message, response.status === 403 || response.status === 429);
  }

  const payload = (await response.json()) as GraphQLResponse<T>;
  if (payload.errors?.length) {
    throw new GitHubApiError(400, payload.errors[0]?.message || 'GitHub GraphQL query failed');
  }

  if (!payload.data) {
    throw new GitHubApiError(500, 'GitHub GraphQL response missing data');
  }

  return payload.data;
}

const DASHBOARD_REPO_SNAPSHOT_QUERY = `
  query DashboardRepoSnapshot($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      databaseId
      name
      nameWithOwner
      description
      url
      stargazerCount
      forkCount
      watchers {
        totalCount
      }
      issues(states: OPEN) {
        totalCount
      }
      licenseInfo {
        name
        spdxId
      }
      createdAt
      updatedAt
      pushedAt
      primaryLanguage {
        name
      }
      defaultBranchRef {
        name
      }
      owner {
        login
        avatarUrl
      }
      languages(first: 100, orderBy: { field: SIZE, direction: DESC }) {
        edges {
          size
          node {
            name
          }
        }
      }
    }
  }
`;

async function fetchDashboardRepoSnapshot(owner: string, repo: string): Promise<DashboardRepoSnapshot> {
  type RepoSnapshotData = {
    repository: {
      databaseId: number | null;
      name: string;
      nameWithOwner: string;
      description: string | null;
      url: string;
      stargazerCount: number;
      forkCount: number;
      watchers: { totalCount: number };
      issues: { totalCount: number };
      licenseInfo: { name: string; spdxId: string } | null;
      createdAt: string;
      updatedAt: string;
      pushedAt: string;
      primaryLanguage: { name: string } | null;
      defaultBranchRef: { name: string } | null;
      owner: { login: string; avatarUrl: string };
      languages: {
        edges: Array<{ size: number; node: { name: string } | null } | null>;
      };
    } | null;
  };

  const payload = await githubGraphql<RepoSnapshotData>(DASHBOARD_REPO_SNAPSHOT_QUERY, {
    owner,
    name: repo,
  });

  const repository = payload.repository;
  if (!repository) {
    throw new GitHubApiError(404, `Repository not found: ${owner}/${repo}`);
  }

  const languages: import('../types/github').GitHubLanguages = {};
  for (const edge of repository.languages.edges ?? []) {
    if (!edge?.node?.name) continue;
    languages[edge.node.name] = edge.size;
  }

  return {
    repo: {
      id: repository.databaseId ?? 0,
      name: repository.name,
      full_name: repository.nameWithOwner,
      description: repository.description,
      html_url: repository.url,
      stargazers_count: repository.stargazerCount,
      forks_count: repository.forkCount,
      watchers_count: repository.watchers.totalCount,
      open_issues_count: repository.issues.totalCount,
      license: repository.licenseInfo
        ? {
            name: repository.licenseInfo.name,
            spdx_id: repository.licenseInfo.spdxId,
          }
        : null,
      created_at: repository.createdAt,
      updated_at: repository.updatedAt,
      pushed_at: repository.pushedAt,
      language: repository.primaryLanguage?.name ?? null,
      default_branch: repository.defaultBranchRef?.name ?? 'main',
      owner: {
        login: repository.owner.login,
        avatar_url: repository.owner.avatarUrl,
      },
    },
    languages,
  };
}

async function fetchContributorsFromGraphQL(owner: string, repo: string): Promise<import('../types/github').GitHubContributor[]> {
  type ContributorsData = {
    repository: {
      defaultBranchRef: {
        target: {
          history: {
            nodes: Array<{
              author: {
                user: {
                  login: string;
                  avatarUrl: string;
                  url: string;
                } | null;
                name: string | null;
              } | null;
            } | null>;
          };
        } | null;
      } | null;
    } | null;
  };

  const query = `
    query ContributorsSnapshot($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) {
        defaultBranchRef {
          target {
            ... on Commit {
              history(first: 500) {
                nodes {
                  author {
                    name
                    user {
                      login
                      avatarUrl
                      url
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  const payload = await githubGraphql<ContributorsData>(query, { owner, name: repo });
  const nodes = payload.repository?.defaultBranchRef?.target?.history?.nodes ?? [];

  const contributions = new Map<string, import('../types/github').GitHubContributor>();

  for (const node of nodes) {
    const user = node?.author?.user;
    const fallbackName = node?.author?.name?.trim();
    const login = user?.login ?? (fallbackName ? `unknown:${fallbackName}` : null);
    if (!login) continue;

    const current = contributions.get(login);
    if (current) {
      current.contributions += 1;
      continue;
    }

    contributions.set(login, {
      login: user?.login ?? fallbackName ?? 'unknown',
      avatar_url: user?.avatarUrl ?? '',
      html_url: user?.url ?? `https://github.com/${owner}`,
      contributions: 1,
    });
  }

  return [...contributions.values()]
    .sort((a, b) => b.contributions - a.contributions)
    .slice(0, 30);
}

function buildMonthlyIssuePrGraphqlQuery(
  monthRanges: Array<{ key: string; start: string; end: string }>,
): string {
  const fields: string[] = [];

  for (const month of monthRanges) {
    const alias = month.key.replace('-', '_');
    fields.push(`
      issue_${alias}: search(type: ISSUE, query: $issueQuery_${alias}, first: 1) {
        issueCount
      }
      pr_${alias}: search(type: ISSUE, query: $prQuery_${alias}, first: 1) {
        issueCount
      }
    `);
  }

  const variableDefs = monthRanges
    .map((month) => month.key.replace('-', '_'))
    .flatMap((alias) => [`$issueQuery_${alias}: String!`, `$prQuery_${alias}: String!`])
    .join(', ');

  return `
    query MonthlyIssuePrCounts(${variableDefs}) {
      ${fields.join('\n')}
    }
  `;
}

function buildMonthlyIssuePrVariables(
  owner: string,
  repo: string,
  monthRanges: Array<{ key: string; start: string; end: string }>,
): Record<string, string> {
  const vars: Record<string, string> = {};

  for (const month of monthRanges) {
    const alias = month.key.replace('-', '_');
    vars[`issueQuery_${alias}`] = `repo:${owner}/${repo} is:issue created:${month.start}..${month.end}`;
    vars[`prQuery_${alias}`] = `repo:${owner}/${repo} is:pr created:${month.start}..${month.end}`;
  }

  return vars;
}

async function fetchMonthlyIssuePrCountsFromGraphQL(
  owner: string,
  repo: string,
  months: number,
): Promise<MonthlyIssuePrCount[]> {
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

  type SearchBucket = { issueCount: number };
  type ResultShape = Record<string, SearchBucket>;

  const query = buildMonthlyIssuePrGraphqlQuery(monthRanges);
  const variables = buildMonthlyIssuePrVariables(owner, repo, monthRanges);
  const payload = await githubGraphql<ResultShape>(query, variables);

  return monthRanges.map((month) => {
    const alias = month.key.replace('-', '_');
    const issueBucket = payload[`issue_${alias}`];
    const prBucket = payload[`pr_${alias}`];
    return {
      month: month.key,
      issues: issueBucket?.issueCount ?? 0,
      pullRequests: prBucket?.issueCount ?? 0,
    };
  });
}

async function fetchGitHubResponse(url: string, init: RequestInit, cacheable: boolean) {
  const cached = cacheable ? readCachedJson<unknown>(url) : null;
  const headers = {
    ...buildGitHubHeaders(useAuthStore.getState().token),
    ...normalizeHeaders(init.headers),
    ...(cached?.etag ? { 'If-None-Match': cached.etag } : {}),
  };

  const response = await fetch(url, {
    ...init,
    headers,
  });

  updateRateLimit(response.headers);

  return { response, cached };
}

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
  const url = new URL(`${GITHUB_API_BASE}${endpoint}`);

  const params = options?.params;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
  }

  const method = (options?.method ?? 'GET').toUpperCase();
  const cacheable = method === 'GET';
  const { response, cached } = await fetchGitHubResponse(url.toString(), options ?? {}, cacheable);

  if (response.status === 304 && cached) {
    return cached.data as T;
  }

  if (!response.ok) {
    const isRateLimit = response.status === 403 || response.status === 429;
    const body = await response.json().catch(() => ({}));
    throw new GitHubApiError(
      response.status,
      body.message || `GitHub API error: ${response.status}`,
      isRateLimit,
    );
  }

  const data = (await response.json()) as T;
  if (cacheable) {
    writeCachedJson(url.toString(), response.headers.get('etag'), data);
  }
  return data;
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
    const url = new URL(`${GITHUB_API_BASE}${endpoint}`);

    const params = options?.params;
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.set(key, value);
      });
    }

    const { response, cached } = await fetchGitHubResponse(url.toString(), options ?? {}, true);

    if (response.status === 304 && cached) {
      return cached.data as T;
    }

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

    const data = (await response.json()) as T;
    writeCachedJson(url.toString(), response.headers.get('etag'), data);
    return data;
  }

  return [] as T;
}

export const githubApi = {
  getRepoSnapshot: (owner: string, repo: string) => fetchDashboardRepoSnapshot(owner, repo),

  getRepo: (owner: string, repo: string) =>
    githubFetch<import('../types/github').GitHubRepo>(`/repos/${owner}/${repo}`),

  getLanguages: (owner: string, repo: string) =>
    githubFetch<import('../types/github').GitHubLanguages>(`/repos/${owner}/${repo}/languages`),

  getContributors: async (owner: string, repo: string) => {
    try {
      const fromGraphql = await fetchContributorsFromGraphQL(owner, repo);
      if (fromGraphql.length > 0) return fromGraphql;
    } catch {
      // Fall through to REST fallback for compatibility.
    }

    return githubFetch<import('../types/github').GitHubContributor[]>(`/repos/${owner}/${repo}/contributors`, {
      params: { per_page: '30' },
    });
  },

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

  getMonthlyIssuePrCounts: (owner: string, repo: string, months: number = 12) =>
    fetchMonthlyIssuePrCountsFromGraphQL(owner, repo, months),
};
