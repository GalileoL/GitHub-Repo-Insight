import type { RawRepoData, RawIssue, RawPull, RawRelease, RawCommit, RawSourceFile } from '../types.js';
import { ghFetch, GITHUB_API } from './client.js';
import { shouldIndexFile } from '../chunking/code-summary.js';

const GITHUB_GRAPHQL_API = `${GITHUB_API}/graphql`;

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

interface GraphQLLabelNode {
  name: string | null;
}

interface GraphQLIssueNode {
  number: number;
  title: string;
  body: string | null;
  state: string;
  url: string;
  createdAt: string;
  author: { login: string | null } | null;
  labels: { nodes: Array<GraphQLLabelNode | null> | null } | null;
}

interface GraphQLPullFileNode {
  path: string | null;
}

interface GraphQLPullNode {
  number: number;
  title: string;
  body: string | null;
  state: string;
  mergedAt: string | null;
  url: string;
  createdAt: string;
  author: { login: string | null } | null;
  labels: { nodes: Array<GraphQLLabelNode | null> | null } | null;
  files: { nodes: Array<GraphQLPullFileNode | null> | null } | null;
}

interface GraphQLReleaseNode {
  tagName: string;
  name: string | null;
  body: string | null;
  url: string;
  publishedAt: string;
  isPrerelease: boolean;
}

interface GraphQLCommitNode {
  oid: string;
  message: string;
  url: string;
  committedDate: string;
  author: { name: string | null; date: string | null } | null;
}

interface GraphQLRepoSnapshot {
  repository: {
    readme: { text: string | null } | null;
    issuesCreated: { nodes: Array<GraphQLIssueNode | null> | null } | null;
    issuesUpdated: { nodes: Array<GraphQLIssueNode | null> | null } | null;
    pullsCreated: { nodes: Array<GraphQLPullNode | null> | null } | null;
    pullsUpdated: { nodes: Array<GraphQLPullNode | null> | null } | null;
    releases: { nodes: Array<GraphQLReleaseNode | null> | null } | null;
    defaultBranchRef: {
      target: {
        history: { nodes: Array<GraphQLCommitNode | null> | null } | null;
      } | null;
    } | null;
  } | null;
}

const GRAPHQL_REPO_SNAPSHOT_QUERY = `
  query RepoSnapshot($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      readme: object(expression: "HEAD:README.md") {
        ... on Blob {
          text
        }
      }
      issuesCreated: issues(first: 100, states: [OPEN, CLOSED], orderBy: { field: CREATED_AT, direction: DESC }) {
        nodes {
          number
          title
          body
          state
          url
          createdAt
          author {
            login
          }
          labels(first: 20) {
            nodes {
              name
            }
          }
        }
      }
      issuesUpdated: issues(first: 100, states: [OPEN, CLOSED], orderBy: { field: UPDATED_AT, direction: DESC }) {
        nodes {
          number
          title
          body
          state
          url
          createdAt
          author {
            login
          }
          labels(first: 20) {
            nodes {
              name
            }
          }
        }
      }
      pullsCreated: pullRequests(first: 100, states: [OPEN, CLOSED, MERGED], orderBy: { field: CREATED_AT, direction: DESC }) {
        nodes {
          number
          title
          body
          state
          mergedAt
          url
          createdAt
          author {
            login
          }
          labels(first: 20) {
            nodes {
              name
            }
          }
          files(first: 30) {
            nodes {
              path
            }
          }
        }
      }
      pullsUpdated: pullRequests(first: 100, states: [OPEN, CLOSED, MERGED], orderBy: { field: UPDATED_AT, direction: DESC }) {
        nodes {
          number
          title
          body
          state
          mergedAt
          url
          createdAt
          author {
            login
          }
          labels(first: 20) {
            nodes {
              name
            }
          }
          files(first: 30) {
            nodes {
              path
            }
          }
        }
      }
      releases(first: 20, orderBy: { field: CREATED_AT, direction: DESC }) {
        nodes {
          tagName
          name
          body
          url
          publishedAt
          isPrerelease
        }
      }
      defaultBranchRef {
        target {
          ... on Commit {
            history(first: 100) {
              nodes {
                oid
                message
                url
                committedDate
                author {
                  name
                  date
                }
              }
            }
          }
        }
      }
    }
  }
`;

async function githubGraphql<T>(query: string, variables: Record<string, string>, token?: string): Promise<T> {
  const response = await fetch(GITHUB_GRAPHQL_API, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    let message = `GitHub GraphQL error ${response.status}`;
    try {
      const body = (await response.json()) as { message?: string; errors?: Array<{ message: string }> };
      message = body.errors?.[0]?.message ?? body.message ?? message;
    } catch {
      // ignore JSON parse failures and fall back to the status-based message
    }
    throw new Error(message);
  }

  const payload = (await response.json()) as GraphQLResponse<T>;
  if (payload.errors?.length) {
    throw new Error(payload.errors[0]?.message ?? 'GitHub GraphQL error');
  }

  if (!payload.data) {
    throw new Error('GitHub GraphQL response missing data');
  }

  return payload.data;
}

function collectNodes<T>(nodes: Array<T | null> | null | undefined): T[] {
  return nodes?.filter((node): node is T => Boolean(node)) ?? [];
}

function collectLabels(nodeLabels: { nodes: Array<GraphQLLabelNode | null> | null } | null | undefined): Array<{ name: string }> {
  return collectNodes(nodeLabels?.nodes)
    .map((label) => label.name)
    .filter((name): name is string => Boolean(name))
    .map((name) => ({ name }));
}

function mapIssueNode(node: GraphQLIssueNode): RawIssue {
  return {
    number: node.number,
    title: node.title,
    body: node.body,
    state: node.state.toLowerCase(),
    html_url: node.url,
    created_at: node.createdAt,
    user: node.author?.login ?? null,
    labels: collectLabels(node.labels),
  };
}

function mapPullNode(node: GraphQLPullNode): RawPull {
  return {
    number: node.number,
    title: node.title,
    body: node.body,
    state: node.state.toLowerCase(),
    merged_at: node.mergedAt,
    html_url: node.url,
    created_at: node.createdAt,
    user: node.author?.login ?? null,
    labels: collectLabels(node.labels),
    changedFiles: collectNodes(node.files?.nodes)
      .map((file) => file.path)
      .filter((path): path is string => Boolean(path)),
  };
}

function mapReleaseNode(node: GraphQLReleaseNode): RawRelease {
  return {
    tag_name: node.tagName,
    name: node.name,
    body: node.body,
    html_url: node.url,
    published_at: node.publishedAt,
    prerelease: node.isPrerelease,
  };
}

function mapCommitNode(node: GraphQLCommitNode): RawCommit {
  return {
    sha: node.oid,
    message: node.message,
    html_url: node.url,
    date: node.committedDate,
    author: node.author?.name ?? null,
  };
}

function dedupeByNumber<T extends { number: number }>(items: T[]): T[] {
  const seen = new Map<number, T>();
  for (const item of items) {
    if (!seen.has(item.number)) {
      seen.set(item.number, item);
    }
  }
  return [...seen.values()];
}

function mergePulls(items: RawPull[]): RawPull[] {
  const merged = new Map<number, RawPull>();

  for (const item of items) {
    const existing = merged.get(item.number);
    if (!existing) {
      merged.set(item.number, item);
      continue;
    }

    const changedFiles = new Set([...(existing.changedFiles ?? []), ...(item.changedFiles ?? [])]);
    merged.set(item.number, {
      ...existing,
      changedFiles: changedFiles.size > 0 ? [...changedFiles] : undefined,
    });
  }

  return [...merged.values()];
}

function parseRepo(repo: string): { owner: string; name: string } {
  const parts = repo.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Invalid repo format: ${repo}`);
  }
  return { owner: parts[0], name: parts[1] };
}

async function fetchRepoDataWithGraphQL(repo: string, token?: string): Promise<RawRepoData> {
  const { owner, name } = parseRepo(repo);

  const snapshot = await githubGraphql<GraphQLRepoSnapshot>(GRAPHQL_REPO_SNAPSHOT_QUERY, { owner, name }, token);
  const repository = snapshot.repository;

  if (!repository) {
    throw new Error(`Repository not found: ${repo}`);
  }

  const issues = dedupeByNumber([
    ...collectNodes(repository.issuesUpdated?.nodes).map(mapIssueNode),
    ...collectNodes(repository.issuesCreated?.nodes).map(mapIssueNode),
  ]);

  const pulls = mergePulls([
    ...collectNodes(repository.pullsCreated?.nodes).map(mapPullNode),
    ...collectNodes(repository.pullsUpdated?.nodes).map(mapPullNode),
  ]);

  const releases = collectNodes(repository.releases?.nodes).map(mapReleaseNode);
  const commits = collectNodes(repository.defaultBranchRef?.target?.history?.nodes).map(mapCommitNode);

  return {
    readme: repository.readme?.text ?? null,
    issues,
    pulls,
    releases,
    commits,
  };
}

async function fetchReadme(repo: string, token?: string): Promise<string | null> {
  try {
    const res = await fetch(`${GITHUB_API}/repos/${repo}/readme`, {
      headers: {
        Accept: 'application/vnd.github.raw+json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!res.ok) return null;
    return res.text();
  } catch {
    return null;
  }
}

interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  state: string;
  html_url: string;
  created_at: string;
  user: { login: string } | null;
  labels: Array<{ name: string }>;
  pull_request?: { url: string };
}

async function fetchIssues(repo: string, token?: string): Promise<RawIssue[]> {
  // Fetch by both "updated" and "created" to get a good mix:
  // - updated: catches long-lived issues with recent activity
  // - created: catches newly opened issues (important for recency questions)
  const [openUpdated, closedUpdated, openCreated, closedCreated] = await Promise.all([
    ghFetch<GitHubIssue[]>(
      `/repos/${repo}/issues?state=open&per_page=100&sort=updated&direction=desc`,
      token,
    ),
    ghFetch<GitHubIssue[]>(
      `/repos/${repo}/issues?state=closed&per_page=100&sort=updated&direction=desc`,
      token,
    ),
    ghFetch<GitHubIssue[]>(
      `/repos/${repo}/issues?state=open&per_page=100&sort=created&direction=desc`,
      token,
    ),
    ghFetch<GitHubIssue[]>(
      `/repos/${repo}/issues?state=closed&per_page=100&sort=created&direction=desc`,
      token,
    ),
  ]);

  // Deduplicate by issue number
  const seen = new Set<number>();
  const all: RawIssue[] = [];

  for (const i of [...openUpdated, ...closedUpdated, ...openCreated, ...closedCreated]) {
    if (i.pull_request || seen.has(i.number)) continue;
    seen.add(i.number);
    all.push({
      number: i.number,
      title: i.title,
      body: i.body,
      state: i.state,
      html_url: i.html_url,
      created_at: i.created_at,
      user: i.user?.login ?? null,
      labels: i.labels,
    });
  }

  return all;
}

interface GitHubPR {
  number: number;
  title: string;
  body: string | null;
  state: string;
  merged_at: string | null;
  html_url: string;
  created_at: string;
  user: { login: string } | null;
  labels: Array<{ name: string }>;
  pull_request?: { url: string };
}

async function fetchPulls(repo: string, token?: string): Promise<RawPull[]> {
  // Fetch by both updated and created to capture recent PRs
  const [byUpdated, byCreated] = await Promise.all([
    ghFetch<GitHubPR[]>(
      `/repos/${repo}/pulls?state=all&per_page=100&sort=updated&direction=desc`,
      token,
    ),
    ghFetch<GitHubPR[]>(
      `/repos/${repo}/pulls?state=all&per_page=100&sort=created&direction=desc`,
      token,
    ),
  ]);

  // Deduplicate
  const seen = new Set<number>();
  const allPRs: GitHubPR[] = [];
  for (const pr of [...byUpdated, ...byCreated]) {
    if (seen.has(pr.number)) continue;
    seen.add(pr.number);
    allPRs.push(pr);
  }

  // Fetch changed files for top 30 PRs
  const enriched = await Promise.all(
    allPRs.slice(0, 30).map(async (pr) => {
      let changedFiles: string[] = [];
      try {
        const files = await ghFetch<Array<{ filename: string }>>(
          `/repos/${repo}/pulls/${pr.number}/files?per_page=30`,
          token,
        );
        changedFiles = files.map((f) => f.filename);
      } catch {
        // skip if rate limited
      }
      return {
        number: pr.number,
        title: pr.title,
        body: pr.body,
        state: pr.state,
        merged_at: pr.merged_at,
        html_url: pr.html_url,
        created_at: pr.created_at,
        user: pr.user?.login ?? null,
        labels: pr.labels,
        changedFiles,
      } satisfies RawPull;
    }),
  );

  // Also include PRs that didn't get file enrichment
  const enrichedNumbers = new Set(enriched.map((p) => p.number));
  const remaining = allPRs.slice(30).map((pr) => ({
    number: pr.number,
    title: pr.title,
    body: pr.body,
    state: pr.state,
    merged_at: pr.merged_at,
    html_url: pr.html_url,
    created_at: pr.created_at,
    user: pr.user?.login ?? null,
    labels: pr.labels,
  } satisfies RawPull));

  return [...enriched, ...remaining.filter((p) => !enrichedNumbers.has(p.number))];
}

async function fetchReleases(repo: string, token?: string): Promise<RawRelease[]> {
  return ghFetch<RawRelease[]>(`/repos/${repo}/releases?per_page=20`, token);
}

interface GitHubCommitItem {
  sha: string;
  html_url: string;
  commit: {
    message: string;
    author: { name: string; date: string } | null;
  };
}

async function fetchCommits(repo: string, token?: string): Promise<RawCommit[]> {
  const commits = await ghFetch<GitHubCommitItem[]>(
    `/repos/${repo}/commits?per_page=100`,
    token,
  );
  return commits.map((c) => ({
    sha: c.sha,
    message: c.commit.message,
    html_url: c.html_url,
    date: c.commit.author?.date ?? '',
    author: c.commit.author?.name ?? null,
  }));
}

// ═══ Source File Fetching (for code summary indexing) ═══════════

const SOURCE_FILE_CAP = 200;
const GUARANTEED_ENTRY_RULES = [
  { pattern: /^api\/.+\.[jt]sx?$/, priority: 4 },
  { pattern: /^(?:src|lib)\/index\.[jt]sx?$/, priority: 3 },
  { pattern: /^lib\/.+\/index\.[jt]sx?$/, priority: 2 },
  { pattern: /^src\/App\.[jt]sx?$/, priority: 2 },
] as const;
const GENERIC_BASENAME_TOKENS = new Set([
  'index',
  'utils',
  'types',
  'type',
  'page',
  'auth',
  'store',
  'hooks',
  'route',
  'routes',
  'handler',
  'helpers',
  'common',
]);

interface GitHubTreeItem {
  path: string;
  type: string;
  size?: number;
  sha?: string;
}

interface GitHubTreeResponse {
  sha: string;
  tree: GitHubTreeItem[];
  truncated: boolean;
}

type SourceTreePath = { path: string; size: number };
type SourceRankingData = Pick<RawRepoData, 'pulls' | 'commits'>;

function isGuaranteedEntryPath(filePath: string): boolean {
  return GUARANTEED_ENTRY_RULES.some(({ pattern }) => pattern.test(filePath));
}

function getGuaranteedEntryPriority(filePath: string): number {
  return GUARANTEED_ENTRY_RULES.find(({ pattern }) => pattern.test(filePath))?.priority ?? 0;
}

function basenameWithoutExt(filePath: string): string {
  const fileName = filePath.split('/').pop() ?? filePath;
  return fileName.replace(/\.[^.]+$/, '');
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function countCommitPathMentions(filePath: string, commits: RawCommit[]): number {
  const normalizedPath = filePath.toLowerCase();
  const basename = basenameWithoutExt(filePath).toLowerCase();
  if (!basename) return 0;

  const basenamePattern = new RegExp(`(^|[^a-z0-9])${escapeRegex(basename)}([^a-z0-9]|$)`, 'i');
  const allowBasenameHeuristic = basename.length >= 6 && !GENERIC_BASENAME_TOKENS.has(basename);

  return commits.reduce((count, commit) => {
    const message = commit.message.toLowerCase();
    if (message.includes(normalizedPath)) return count + 1;
    if (allowBasenameHeuristic && basenamePattern.test(message)) return count + 1;
    return count;
  }, 0);
}

function countPrHitsByPath(filePath: string, pulls: RawPull[]): number {
  return pulls.reduce((count, pull) => (
    count + (pull.changedFiles?.filter((changedPath) => changedPath === filePath).length ?? 0)
  ), 0);
}

function estimateExportCount(filePath: string, content: string): number {
  if (/\.(ts|tsx|js|jsx)$/.test(filePath)) {
    return (content.match(/\bexport\b/g) ?? []).length;
  }
  if (/\.py$/.test(filePath)) {
    return (content.match(/^(?:def|class|async def)\s+/gm) ?? []).length;
  }
  if (/\.go$/.test(filePath)) {
    return (content.match(/^func\s+[A-Z]\w*/gm) ?? []).length;
  }
  return 0;
}

function scoreSize(size: number): number {
  return 1 / Math.max(size, 1);
}

function normalizeWeight(value: number, maxValue: number): number {
  if (maxValue <= 0) return 0;
  return value / maxValue;
}

export function prioritizeSourceFilePaths(
  paths: SourceTreePath[],
  rankingData?: SourceRankingData,
  cap: number = SOURCE_FILE_CAP,
): SourceTreePath[] {
  const prHitCounts = new Map<string, number>();
  const changeFrequencies = new Map<string, number>();

  for (const item of paths) {
    prHitCounts.set(item.path, rankingData ? countPrHitsByPath(item.path, rankingData.pulls) : 0);
    changeFrequencies.set(item.path, rankingData ? countCommitPathMentions(item.path, rankingData.commits) : 0);
  }

  const maxPrHits = Math.max(...prHitCounts.values(), 0);
  const maxChangeFrequency = Math.max(...changeFrequencies.values(), 0);
  const maxInverseSize = Math.max(...paths.map((item) => scoreSize(item.size)), 0);

  const rankCompetitiveScore = (item: SourceTreePath): number => (
    normalizeWeight(changeFrequencies.get(item.path) ?? 0, maxChangeFrequency) * 0.4 +
    normalizeWeight(prHitCounts.get(item.path) ?? 0, maxPrHits) * 0.3 +
    normalizeWeight(scoreSize(item.size), maxInverseSize) * 0.3
  );

  const rankGuaranteedScore = (item: SourceTreePath): number => (
    getGuaranteedEntryPriority(item.path) * 10 + rankCompetitiveScore(item)
  );

  if (paths.length <= cap) {
    return [...paths].sort((a, b) => {
      const guaranteedDelta = getGuaranteedEntryPriority(b.path) - getGuaranteedEntryPriority(a.path);
      if (guaranteedDelta !== 0) return guaranteedDelta;
      const scoreDelta = rankCompetitiveScore(b) - rankCompetitiveScore(a);
      if (scoreDelta !== 0) return scoreDelta;
      if (a.size !== b.size) return a.size - b.size;
      return a.path.localeCompare(b.path);
    });
  }

  const guaranteed = paths.filter((item) => isGuaranteedEntryPath(item.path));
  const guaranteedMap = new Set(guaranteed.map((item) => item.path));
  const remaining = paths.filter((item) => !guaranteedMap.has(item.path));
  const guaranteedSelected = guaranteed
    .sort((a, b) => {
      const scoreDelta = rankGuaranteedScore(b) - rankGuaranteedScore(a);
      if (scoreDelta !== 0) return scoreDelta;
      if (a.size !== b.size) return a.size - b.size;
      return a.path.localeCompare(b.path);
    })
    .slice(0, Math.min(cap, guaranteed.length));

  const competitive = [...remaining]
    .sort((a, b) => {
      const scoreDelta = rankCompetitiveScore(b) - rankCompetitiveScore(a);
      if (scoreDelta !== 0) return scoreDelta;
      if (a.size !== b.size) return a.size - b.size;
      return a.path.localeCompare(b.path);
    })
    .slice(0, Math.max(0, cap - guaranteedSelected.length));

  return [...guaranteedSelected, ...competitive];
}

export function prioritizeFetchedSourceFiles(
  files: RawSourceFile[],
  rankingData?: SourceRankingData,
): RawSourceFile[] {
  if (files.length <= 1) return files;

  const prHitCounts = new Map<string, number>();
  const changeFrequencies = new Map<string, number>();
  const exportCounts = new Map<string, number>();

  for (const file of files) {
    prHitCounts.set(file.path, rankingData ? countPrHitsByPath(file.path, rankingData.pulls) : 0);
    changeFrequencies.set(file.path, rankingData ? countCommitPathMentions(file.path, rankingData.commits) : 0);
    exportCounts.set(file.path, estimateExportCount(file.path, file.content));
  }

  const maxPrHits = Math.max(...prHitCounts.values(), 0);
  const maxChangeFrequency = Math.max(...changeFrequencies.values(), 0);
  const maxExportCount = Math.max(...exportCounts.values(), 0);
  const maxInverseSize = Math.max(...files.map((file) => scoreSize(file.size)), 0);

  return [...files].sort((a, b) => {
    const aScore =
      normalizeWeight(changeFrequencies.get(a.path) ?? 0, maxChangeFrequency) * 0.4 +
      normalizeWeight(prHitCounts.get(a.path) ?? 0, maxPrHits) * 0.3 +
      normalizeWeight(exportCounts.get(a.path) ?? 0, maxExportCount) * 0.2 +
      normalizeWeight(scoreSize(a.size), maxInverseSize) * 0.1;
    const bScore =
      normalizeWeight(changeFrequencies.get(b.path) ?? 0, maxChangeFrequency) * 0.4 +
      normalizeWeight(prHitCounts.get(b.path) ?? 0, maxPrHits) * 0.3 +
      normalizeWeight(exportCounts.get(b.path) ?? 0, maxExportCount) * 0.2 +
      normalizeWeight(scoreSize(b.size), maxInverseSize) * 0.1;

    if (bScore !== aScore) return bScore - aScore;
    if (a.size !== b.size) return a.size - b.size;
    return a.path.localeCompare(b.path);
  });
}

/** Fetch the repo file tree and filter to indexable source files */
async function fetchRepoTree(repo: string, token?: string): Promise<{ paths: Array<{ path: string; size: number }>; headSha: string }> {
  const tree = await ghFetch<GitHubTreeResponse>(
    `/repos/${repo}/git/trees/HEAD?recursive=1`,
    token,
  );

  const paths = tree.tree
    .filter((item) => item.type === 'blob' && shouldIndexFile(item.path, item.size))
    .map((item) => ({ path: item.path, size: item.size ?? 0 }));

  return { paths, headSha: tree.sha };
}

/** Reason a single file fetch failed, surfaced into eval events. */
export type FileFetchFailureReason =
  | 'not_found'
  | 'forbidden'
  | 'too_large'
  | 'timeout'
  | 'rate_limited'
  | 'unknown';

/** Result from a single file fetch attempt. Either content or a classified reason. */
export type FileFetchResult =
  | { ok: true; content: string }
  | { ok: false; reason: FileFetchFailureReason; status?: number };

const FETCH_FILE_TIMEOUT_MS = 2500;

function classifyFetchStatus(status: number): FileFetchFailureReason {
  if (status === 404) return 'not_found';
  if (status === 403) return 'forbidden';
  if (status === 429) return 'rate_limited';
  if (status === 413) return 'too_large';
  return 'unknown';
}

/**
 * Fetch the raw content of a single file via the GitHub Contents API.
 *
 * Returns `null` for backwards compatibility with callers that only need the
 * content; use `fetchFileContentDetailed` when the failure reason matters for
 * evaluation or retries.
 */
export async function fetchFileContent(
  repo: string,
  filePath: string,
  token?: string,
): Promise<string | null> {
  const result = await fetchFileContentDetailed(repo, filePath, token);
  return result.ok ? result.content : null;
}

/** Detailed variant of fetchFileContent that classifies failures. */
export async function fetchFileContentDetailed(
  repo: string,
  filePath: string,
  token?: string,
  options?: { signal?: AbortSignal },
): Promise<FileFetchResult> {
  const controller = new AbortController();
  const abortExternal = () => controller.abort();
  const externalSignal = options?.signal;
  if (externalSignal?.aborted) {
    return { ok: false, reason: 'timeout' };
  }
  externalSignal?.addEventListener('abort', abortExternal);
  const timer = setTimeout(() => controller.abort(), FETCH_FILE_TIMEOUT_MS);

  try {
    const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
    const res = await fetch(`${GITHUB_API}/repos/${repo}/contents/${encodedPath}`, {
      headers: {
        Accept: 'application/vnd.github.raw+json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      return { ok: false, reason: classifyFetchStatus(res.status), status: res.status };
    }

    return { ok: true, content: await res.text() };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, reason: 'timeout' };
    }
    return { ok: false, reason: 'unknown' };
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', abortExternal);
  }
}

/** Fetch source files for code summary indexing, with cap and priority */
export async function fetchRepoSourceFiles(
  repo: string,
  token?: string,
  rankingData?: SourceRankingData,
): Promise<{ files: RawSourceFile[]; headSha: string }> {
  const { paths, headSha } = await fetchRepoTree(repo, token);
  const candidates = prioritizeSourceFilePaths(paths, rankingData, SOURCE_FILE_CAP);

  // Fetch file contents in batches of 10 to avoid overwhelming the API
  const files: RawSourceFile[] = [];
  const BATCH_SIZE = 10;

  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (item) => {
        const content = await fetchFileContent(repo, item.path, token);
        if (!content) return null;
        return { path: item.path, content, size: item.size } satisfies RawSourceFile;
      }),
    );
    for (const r of results) {
      if (r) files.push(r);
    }
  }

  return { files: prioritizeFetchedSourceFiles(files, rankingData), headSha };
}

/** Fetch all data sources for a repository */
export async function fetchRepoData(
  repo: string,
  token?: string,
): Promise<RawRepoData> {
  parseRepo(repo);

  try {
    return await fetchRepoDataWithGraphQL(repo, token);
  } catch {
    const [readme, issues, pulls, releases, commits] = await Promise.all([
      fetchReadme(repo, token),
      fetchIssues(repo, token),
      fetchPulls(repo, token),
      fetchReleases(repo, token),
      fetchCommits(repo, token),
    ]);

    return { readme, issues, pulls, releases, commits };
  }
}
