import type { Chunk, RawRelease } from '../types.js';

/** Convert each release into a chunk */
export function chunkReleases(repo: string, releases: RawRelease[]): Chunk[] {
  return releases.map((release) => {
    const name = release.name ?? release.tag_name;
    const body = release.body ? release.body.slice(0, 3000) : '';

    return {
      id: `${repo}:release:${release.tag_name}`,
      content: `Release ${name} (${release.tag_name})\nPublished: ${release.published_at.slice(0, 10)}\n\n${body}`.trim(),
      metadata: {
        repo,
        type: 'release' as const,
        title: `Release ${name}`,
        githubUrl: release.html_url,
        releaseName: name,
        createdAt: release.published_at,
        tags: release.prerelease ? ['prerelease'] : [],
      },
    };
  });
}
