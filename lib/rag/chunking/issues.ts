import type { Chunk, RawIssue } from '../types.js';

/** Convert each issue into a chunk (title + body) */
export function chunkIssues(repo: string, issues: RawIssue[]): Chunk[] {
  return issues.map((issue) => {
    const body = issue.body ? issue.body.slice(0, 3000) : '';
    const labels = issue.labels.map((l) => l.name);

    return {
      id: `${repo}:issue:${issue.number}`,
      content: `Issue #${issue.number}: ${issue.title}\nCreated: ${issue.created_at.slice(0, 10)} | Author: ${issue.user ?? 'unknown'} | State: ${issue.state}\n\n${body}`.trim(),
      metadata: {
        repo,
        type: 'issue' as const,
        title: `Issue #${issue.number} — ${issue.title}`,
        githubUrl: issue.html_url,
        issueNumber: issue.number,
        createdAt: issue.created_at,
        tags: labels,
      },
    };
  });
}
