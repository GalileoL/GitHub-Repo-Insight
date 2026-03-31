import type { AnalyticsQuery, AnalyticsResult, DateRange, AnalyticsEntity } from './types.js';

const GITHUB_API = 'https://api.github.com';
const MAX_PAGES = 30; // 3000 items max to stay within reasonable API usage

// ═══ GitHub API Helpers ══════════════════════════════════════

async function ghFetch<T>(path: string, token?: string): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${GITHUB_API}${path}`, { headers });
  if (!res.ok) {
    throw new Error(`GitHub API error ${res.status}: ${path}`);
  }
  return res.json() as Promise<T>;
}

// ═══ Paginated Fetchers ══════════════════════════════════════

interface GitHubPRItem {
  number: number;
  created_at: string;
  merged_at: string | null;
  state: string;
  user: { login: string } | null;
}

interface GitHubIssueItem {
  number: number;
  created_at: string;
  state: string;
  user: { login: string } | null;
  pull_request?: { url: string };
}

interface GitHubCommitItem {
  sha: string;
  commit: { author: { name: string; date: string } | null };
}

function isInRange(dateStr: string, range: DateRange | null): boolean {
  if (!range) return true;
  return dateStr >= range.since && dateStr <= range.until;
}

function isBeforeRange(dateStr: string, range: DateRange | null): boolean {
  if (!range) return false;
  return dateStr < range.since;
}

async function fetchPRs(
  repo: string,
  query: AnalyticsQuery,
  token?: string,
): Promise<{ items: GitHubPRItem[]; truncated: boolean }> {
  const apiState = query.state === 'merged' ? 'closed' : query.state === 'all' ? 'all' : query.state;
  const items: GitHubPRItem[] = [];
  let truncated = false;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const batch = await ghFetch<GitHubPRItem[]>(
      `/repos/${repo}/pulls?state=${apiState}&sort=created&direction=desc&per_page=100&page=${page}`,
      token,
    );
    if (batch.length === 0) break;

    for (const pr of batch) {
      if (isBeforeRange(pr.created_at, query.dateRange)) {
        return { items, truncated: false }; // all remaining are older
      }
      if (!isInRange(pr.created_at, query.dateRange)) continue;
      if (query.state === 'merged' && !pr.merged_at) continue;
      items.push(pr);
    }

    if (batch.length < 100) break;
    if (page === MAX_PAGES) truncated = true;
  }

  return { items, truncated };
}

async function fetchIssues(
  repo: string,
  query: AnalyticsQuery,
  token?: string,
): Promise<{ items: GitHubIssueItem[]; truncated: boolean }> {
  const apiState = query.state === 'merged' ? 'closed' : query.state === 'all' ? 'all' : query.state;
  const items: GitHubIssueItem[] = [];
  let truncated = false;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const batch = await ghFetch<GitHubIssueItem[]>(
      `/repos/${repo}/issues?state=${apiState}&sort=created&direction=desc&per_page=100&page=${page}`,
      token,
    );
    if (batch.length === 0) break;

    for (const issue of batch) {
      if (issue.pull_request) continue; // GitHub issues API includes PRs
      if (isBeforeRange(issue.created_at, query.dateRange)) {
        return { items, truncated: false };
      }
      if (!isInRange(issue.created_at, query.dateRange)) continue;
      items.push(issue);
    }

    if (batch.length < 100) break;
    if (page === MAX_PAGES) truncated = true;
  }

  return { items, truncated };
}

async function fetchCommits(
  repo: string,
  query: AnalyticsQuery,
  token?: string,
): Promise<{ items: GitHubCommitItem[]; truncated: boolean }> {
  const items: GitHubCommitItem[] = [];
  let truncated = false;

  // Commits API natively supports since/until
  const params = new URLSearchParams({ per_page: '100' });
  if (query.dateRange) {
    params.set('since', query.dateRange.since);
    params.set('until', query.dateRange.until);
  }

  for (let page = 1; page <= MAX_PAGES; page++) {
    params.set('page', String(page));
    const batch = await ghFetch<GitHubCommitItem[]>(
      `/repos/${repo}/commits?${params.toString()}`,
      token,
    );
    if (batch.length === 0) break;
    items.push(...batch);

    if (batch.length < 100) break;
    if (page === MAX_PAGES) truncated = true;
  }

  return { items, truncated };
}

// ═══ Top Authors Aggregation ═════════════════════════════════

function computeTopAuthors(
  items: Array<{ user?: { login: string } | null; commit?: { author: { name: string } | null } }>,
  limit: number = 10,
): Array<{ author: string; count: number }> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const author =
      (item.user as { login: string } | null | undefined)?.login
      ?? (item.commit as { author: { name: string } | null } | undefined)?.author?.name
      ?? 'unknown';
    counts.set(author, (counts.get(author) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([author, count]) => ({ author, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

// ═══ Answer Formatting ═══════════════════════════════════════

const ENTITY_LABELS: Record<AnalyticsEntity, { singular: string; plural: string }> = {
  pr: { singular: 'pull request', plural: 'pull requests' },
  issue: { singular: 'issue', plural: 'issues' },
  commit: { singular: 'commit', plural: 'commits' },
};

function formatDateRange(range: DateRange | null): string {
  if (!range) return '';
  const since = range.since.slice(0, 10);
  const until = range.until.slice(0, 10);
  return ` between **${since}** and **${until}**`;
}

function formatState(state: string, entity: AnalyticsEntity): string {
  if (state === 'all') return '';
  if (state === 'merged' && entity === 'pr') return ' merged';
  return ` ${state}`;
}

function formatCountAnswer(
  count: number,
  query: AnalyticsQuery,
  truncated: boolean,
): string {
  const label = count === 1 ? ENTITY_LABELS[query.entity].singular : ENTITY_LABELS[query.entity].plural;
  const stateStr = formatState(query.state, query.entity);
  const dateStr = formatDateRange(query.dateRange);
  const truncNote = truncated ? '\n\n> Note: results may be incomplete — the query reached the pagination limit.' : '';

  return `Found **${count}**${stateStr} ${label}${dateStr}.${truncNote}`;
}

function formatTopAuthorsAnswer(
  topAuthors: Array<{ author: string; count: number }>,
  totalCount: number,
  query: AnalyticsQuery,
  truncated: boolean,
): string {
  const label = ENTITY_LABELS[query.entity].plural;
  const stateStr = formatState(query.state, query.entity);
  const dateStr = formatDateRange(query.dateRange);
  const truncNote = truncated ? '\n\n> Note: results may be incomplete — the query reached the pagination limit.' : '';

  const lines = [`Top contributors by${stateStr} ${label}${dateStr} (${totalCount} total):\n`];
  lines.push('| Rank | Author | Count |');
  lines.push('|------|--------|-------|');
  topAuthors.forEach((a, i) => {
    lines.push(`| ${i + 1} | @${a.author} | ${a.count} |`);
  });
  lines.push(truncNote);

  return lines.join('\n');
}

// ═══ Main Executor ═══════════════════════════════════════════

export async function executeAnalyticsQuery(
  repo: string,
  query: AnalyticsQuery,
  token?: string,
): Promise<AnalyticsResult> {
  const t0 = Date.now();

  let items: Array<{ user?: { login: string } | null }>;
  let truncated: boolean;

  switch (query.entity) {
    case 'pr': {
      const result = await fetchPRs(repo, query, token);
      items = result.items;
      truncated = result.truncated;
      break;
    }
    case 'issue': {
      const result = await fetchIssues(repo, query, token);
      items = result.items;
      truncated = result.truncated;
      break;
    }
    case 'commit': {
      const result = await fetchCommits(repo, query, token);
      items = result.items;
      truncated = result.truncated;
      break;
    }
  }

  const durationMs = Date.now() - t0;

  // Log structured analytics for observability
  console.log(JSON.stringify({
    type: 'analytics_query',
    repo,
    op: query.op,
    entity: query.entity,
    state: query.state,
    hasDateRange: query.dateRange !== null,
    count: items.length,
    truncated,
    durationMs,
  }));

  if (query.op === 'top_authors') {
    const topAuthors = computeTopAuthors(items as Array<{ user?: { login: string } | null; commit?: { author: { name: string } | null } }>);
    return {
      answer: formatTopAuthorsAnswer(topAuthors, items.length, query, truncated),
      data: {
        op: query.op,
        entity: query.entity,
        dateRange: query.dateRange,
        state: query.state,
        count: items.length,
        truncated,
        topAuthors,
      },
    };
  }

  return {
    answer: formatCountAnswer(items.length, query, truncated),
    data: {
      op: query.op,
      entity: query.entity,
      dateRange: query.dateRange,
      state: query.state,
      count: items.length,
      truncated,
    },
  };
}
