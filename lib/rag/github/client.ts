export const GITHUB_API = 'https://api.github.com';

/** Shared GitHub API fetch helper with token-based auth */
export async function ghFetch<T>(path: string, token?: string): Promise<T> {
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
