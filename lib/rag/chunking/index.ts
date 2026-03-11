import type { Chunk, RawRepoData } from '../types.js';
import { chunkReadme } from './readme.js';
import { chunkIssues } from './issues.js';
import { chunkPulls } from './pulls.js';
import { chunkReleases } from './releases.js';
import { chunkCommits } from './commits.js';

/** Convert raw repo data into embeddable chunks */
export function chunkRepoData(repo: string, data: RawRepoData): Chunk[] {
  const chunks: Chunk[] = [];

  if (data.readme) {
    chunks.push(...chunkReadme(repo, data.readme));
  }
  chunks.push(...chunkIssues(repo, data.issues));
  chunks.push(...chunkPulls(repo, data.pulls));
  chunks.push(...chunkReleases(repo, data.releases));
  chunks.push(...chunkCommits(repo, data.commits));

  return chunks;
}

export { chunkReadme, chunkIssues, chunkPulls, chunkReleases, chunkCommits };
