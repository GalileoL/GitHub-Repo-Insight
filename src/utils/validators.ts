import { z } from 'zod';

export const repoSlugSchema = z
  .string()
  .trim()
  .transform((val) => val.replace(/\/$/, ''))
  .pipe(
    z.union([
      z.string().regex(/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/, 'Invalid repository format'),
      z.string().url().transform((url) => {
        const match = url.match(/github\.com\/([^/]+)\/([^/]+)/);
        if (!match) throw new Error('Not a valid GitHub URL');
        return `${match[1]}/${match[2]}`;
      }),
    ]),
  );

export function parseRepoInput(input: string): { owner: string; repo: string } | null {
  const result = repoSlugSchema.safeParse(input);
  if (!result.success) return null;
  const [owner, repo] = result.data.split('/');
  return owner && repo ? { owner, repo } : null;
}
