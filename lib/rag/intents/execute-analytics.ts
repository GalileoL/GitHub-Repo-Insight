import type { AnalyticsQuery, AnalyticsResult, DateRange, AnalyticsEntity } from './types.js';
import { ghFetch } from '../github/client.js';

const MAX_PAGES = 30; // 3000 items max to stay within reasonable API usage

// ═══ Paginated Fetchers ══════════════════════════════════════

interface GitHubPRItem {
  number: number;
  created_at: string;
  updated_at: string;
  merged_at: string | null;
  state: string;
  user: { login: string } | null;
}

interface GitHubIssueItem {
  number: number;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
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
  const sortByUpdated = query.state === 'merged' && query.dateRange !== null;
  const items: GitHubPRItem[] = [];
  let truncated = false;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const batch = await ghFetch<GitHubPRItem[]>(
      `/repos/${repo}/pulls?state=${apiState}&sort=${sortByUpdated ? 'updated' : 'created'}&direction=desc&per_page=100&page=${page}`,
      token,
    );
    if (batch.length === 0) break;

    for (const pr of batch) {
      if (sortByUpdated && isBeforeRange(pr.updated_at, query.dateRange)) {
        return { items, truncated: false };
      }

      // For merged PR questions, the user usually means merge time, not creation time.
      if (query.state === 'merged' && !pr.merged_at) continue;

      const filterDate = query.state === 'merged' ? pr.merged_at : pr.created_at;

      if (query.state !== 'merged' && isBeforeRange(pr.created_at, query.dateRange)) {
        return { items, truncated: false }; // all remaining are older
      }
      if (!filterDate || !isInRange(filterDate, query.dateRange)) continue;
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
  const sortByUpdated = query.state === 'closed' && query.dateRange !== null;
  const items: GitHubIssueItem[] = [];
  let truncated = false;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const batch = await ghFetch<GitHubIssueItem[]>(
      `/repos/${repo}/issues?state=${apiState}&sort=${sortByUpdated ? 'updated' : 'created'}&direction=desc&per_page=100&page=${page}`,
      token,
    );
    if (batch.length === 0) break;

    for (const issue of batch) {
      if (issue.pull_request) continue; // GitHub issues API includes PRs

      if (sortByUpdated && isBeforeRange(issue.updated_at, query.dateRange)) {
        return { items, truncated: false };
      }

      const filterDate = query.state === 'closed' ? issue.closed_at : issue.created_at;

      if (query.state !== 'closed' && isBeforeRange(issue.created_at, query.dateRange)) {
        return { items, truncated: false };
      }
      if (!filterDate || !isInRange(filterDate, query.dateRange)) continue;
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

function getAuthorFromPROrIssue(item: GitHubPRItem | GitHubIssueItem): string {
  return item.user?.login ?? 'unknown';
}

function getAuthorFromCommit(item: GitHubCommitItem): string {
  return item.commit?.author?.name ?? 'unknown';
}

function computeTopAuthors(
  authors: string[],
  limit: number = 10,
): Array<{ author: string; count: number }> {
  const counts = new Map<string, number>();
  for (const author of authors) {
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
  if (entity === 'commit') return '';
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

  let count: number;
  let truncated: boolean;
  let authors: string[] = [];

  switch (query.entity) {
    case 'pr': {
      const result = await fetchPRs(repo, query, token);
      count = result.items.length;
      truncated = result.truncated;
      if (query.op === 'top_authors') authors = result.items.map(getAuthorFromPROrIssue);
      break;
    }
    case 'issue': {
      const result = await fetchIssues(repo, query, token);
      count = result.items.length;
      truncated = result.truncated;
      if (query.op === 'top_authors') authors = result.items.map(getAuthorFromPROrIssue);
      break;
    }
    case 'commit': {
      const result = await fetchCommits(repo, query, token);
      count = result.items.length;
      truncated = result.truncated;
      if (query.op === 'top_authors') authors = result.items.map(getAuthorFromCommit);
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
    count,
    truncated,
    durationMs,
  }));

  if (query.op === 'top_authors') {
    const topAuthors = computeTopAuthors(authors);
    return {
      answer: formatTopAuthorsAnswer(topAuthors, count, query, truncated),
      data: {
        op: query.op,
        entity: query.entity,
        dateRange: query.dateRange,
        state: query.state,
        count,
        truncated,
        topAuthors,
      },
    };
  }

  return {
    answer: formatCountAnswer(count, query, truncated),
    data: {
      op: query.op,
      entity: query.entity,
      dateRange: query.dateRange,
      state: query.state,
      count,
      truncated,
    },
  };
}
