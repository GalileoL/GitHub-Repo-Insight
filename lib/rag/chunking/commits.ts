import type { Chunk, RawCommit } from '../types.js';

/**
 * Group recent commits into batches and create a chunk per batch.
 * This prevents hundreds of tiny single-line chunks.
 */
export function chunkCommits(repo: string, commits: RawCommit[]): Chunk[] {
  const BATCH_SIZE = 10;
  const chunks: Chunk[] = [];

  for (let i = 0; i < commits.length; i += BATCH_SIZE) {
    const batch = commits.slice(i, i + BATCH_SIZE);
    const batchIdx = Math.floor(i / BATCH_SIZE);

    const lines = batch.map(
      (c) => `- [${c.date.slice(0, 10)}] ${c.message.split('\n')[0]} by ${c.author ?? 'unknown'} (${c.sha.slice(0, 7)})`,
    );

    const firstDate = batch[0]?.date ?? '';
    const lastDate = batch[batch.length - 1]?.date ?? '';

    chunks.push({
      id: `${repo}:commits:${batchIdx}`,
      content: `Recent commits (batch ${batchIdx + 1}):\n${lines.join('\n')}`,
      metadata: {
        repo,
        type: 'commit' as const,
        title: `Commits batch ${batchIdx + 1}`,
        githubUrl: `https://github.com/${repo}/commits`,
        commitSha: batch[0]?.sha,
        createdAt: firstDate || lastDate || undefined,
      },
    });
  }

  return chunks;
}
