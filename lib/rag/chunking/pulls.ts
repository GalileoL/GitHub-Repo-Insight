import type { Chunk, RawPull } from '../types.js';

/** Convert each PR into 1–2 chunks (description + changed files) */
export function chunkPulls(repo: string, pulls: RawPull[]): Chunk[] {
  const chunks: Chunk[] = [];

  for (const pr of pulls) {
    const body = pr.body ? pr.body.slice(0, 3000) : '';
    const labels = pr.labels.map((l) => l.name);

    // Main PR chunk (title + body)
    chunks.push({
      id: `${repo}:pr:${pr.number}`,
      content: `PR #${pr.number}: ${pr.title}\nCreated: ${pr.created_at.slice(0, 10)} | Author: ${pr.user ?? 'unknown'} | State: ${pr.state}${pr.merged_at ? ' (merged ' + pr.merged_at.slice(0, 10) + ')' : ''}\n\n${body}`.trim(),
      metadata: {
        repo,
        type: 'pr' as const,
        title: `PR #${pr.number} — ${pr.title}`,
        githubUrl: pr.html_url,
        prNumber: pr.number,
        createdAt: pr.created_at,
        tags: labels,
      },
    });

    // Changed files chunk (if available)
    if (pr.changedFiles && pr.changedFiles.length > 0) {
      chunks.push({
        id: `${repo}:pr-files:${pr.number}`,
        content: `PR #${pr.number} "${pr.title}" changed these files:\n${pr.changedFiles.join('\n')}`,
        metadata: {
          repo,
          type: 'pr' as const,
          title: `PR #${pr.number} changed files`,
          githubUrl: `${pr.html_url}/files`,
          prNumber: pr.number,
          createdAt: pr.created_at,
          tags: labels,
        },
      });
    }
  }

  return chunks;
}
