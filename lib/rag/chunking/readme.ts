import type { Chunk } from '../types.js';

/**
 * Split README by markdown headings (## level).
 * Each section becomes a chunk with the heading as its title.
 */
export function chunkReadme(repo: string, readme: string): Chunk[] {
  const lines = readme.split('\n');
  const sections: Array<{ title: string; content: string; startIdx: number }> = [];

  let currentTitle = 'Introduction';
  let currentLines: string[] = [];
  let startIdx = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headingMatch = /^#{1,3}\s+(.+)/.exec(line);
    if (headingMatch && currentLines.length > 0) {
      sections.push({
        title: currentTitle,
        content: currentLines.join('\n').trim(),
        startIdx,
      });
      currentTitle = headingMatch[1].trim();
      currentLines = [];
      startIdx = i;
    } else {
      currentLines.push(line);
    }
  }

  // Push the last section
  if (currentLines.length > 0) {
    sections.push({
      title: currentTitle,
      content: currentLines.join('\n').trim(),
      startIdx,
    });
  }

  return sections
    .filter((s) => s.content.length > 20) // skip trivially empty sections
    .map((s, i) => ({
      id: `${repo}:readme:${i}`,
      content: `# ${s.title}\n\n${s.content}`.slice(0, 4000), // cap to ~4k chars
      metadata: {
        repo,
        type: 'readme' as const,
        title: `README — ${s.title}`,
        githubUrl: `https://github.com/${repo}#readme`,
        createdAt: undefined,
      },
    }));
}
