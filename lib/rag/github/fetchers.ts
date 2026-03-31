import type { RawRepoData, RawIssue, RawPull, RawRelease, RawCommit } from '../types.js';
import { ghFetch, GITHUB_API } from './client.js';

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

/** Fetch all data sources for a repository */
export async function fetchRepoData(
  repo: string,
  token?: string,
): Promise<RawRepoData> {
  const [readme, issues, pulls, releases, commits] = await Promise.all([
    fetchReadme(repo, token),
    fetchIssues(repo, token),
    fetchPulls(repo, token),
    fetchReleases(repo, token),
    fetchCommits(repo, token),
  ]);

  return { readme, issues, pulls, releases, commits };
}
