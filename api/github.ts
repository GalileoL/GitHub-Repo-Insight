import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getGitHubAccessToken } from '../lib/rag/auth/index.js';

const GITHUB_API_BASE = 'https://api.github.com';
const ALLOWED_PATH_PREFIXES = ['/repos/', '/graphql'];

function parsePath(input: string | string[] | undefined): string | null {
  const value = Array.isArray(input) ? input[0] : input;
  if (!value || typeof value !== 'string') return null;
  if (!value.startsWith('/')) return null;
  if (!ALLOWED_PATH_PREFIXES.some((prefix) => value.startsWith(prefix))) return null;
  return value;
}

function setForwardHeaders(res: VercelResponse, upstream: Response): void {
  const headersToForward = ['etag', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset', 'x-ratelimit-used'];
  for (const header of headersToForward) {
    const value = upstream.headers.get(header);
    if (value) {
      res.setHeader(header, value);
    }
  }
}

async function readJsonBody(req: VercelRequest): Promise<Record<string, unknown>> {
  const body = req.body;
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    return body as Record<string, unknown>;
  }

  if (typeof body === 'string' && body.trim()) {
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // Ignore parse failures and fall back to an empty body.
    }
  }

  return {};
}

async function forwardToGitHub(
  req: VercelRequest,
  res: VercelResponse,
  targetPath: string,
  method: 'GET' | 'POST',
  body?: Record<string, unknown>,
): Promise<void> {
  const token = await getGitHubAccessToken(req, res);
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const ifNoneMatch = req.headers['if-none-match'];
  if (typeof ifNoneMatch === 'string' && ifNoneMatch.trim()) {
    headers['If-None-Match'] = ifNoneMatch;
  }

  const url = new URL(`${GITHUB_API_BASE}${targetPath}`);
  if (method === 'GET') {
    const queryParams = new URLSearchParams();
    for (const [key, value] of Object.entries(req.query)) {
      if (key === 'path') continue;
      const raw = Array.isArray(value) ? value[0] : value;
      if (typeof raw === 'string' && raw.length > 0) {
        queryParams.set(key, raw);
      }
    }
    url.search = queryParams.toString();
  } else {
    headers['Content-Type'] = 'application/json';
  }

  const upstream = await fetch(url.toString(), {
    method,
    headers,
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  });

  setForwardHeaders(res, upstream);

  if (upstream.status === 304) {
    res.status(304).end();
    return;
  }

  const text = await upstream.text();
  let payload: unknown = {};

  if (text) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      payload = { message: text };
    }
  }

  res.status(upstream.status).json(payload);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    const targetPath = parsePath(req.query.path);
    if (!targetPath) {
      return res.status(400).json({ error: 'Missing or invalid GitHub path.' });
    }

    return forwardToGitHub(req, res, targetPath, 'GET');
  }

  if (req.method === 'POST') {
    const body = await readJsonBody(req);
    const targetPath = typeof body.path === 'string' ? parsePath(body.path) : null;
    if (!targetPath) {
      return res.status(400).json({ error: 'Missing or invalid GitHub path.' });
    }

    const method = typeof body.method === 'string' ? body.method.toUpperCase() : 'POST';
    if (method !== 'POST') {
      return res.status(400).json({ error: 'Unsupported GitHub proxy method.' });
    }

    return forwardToGitHub(req, res, targetPath, 'POST', {
      query: typeof body.query === 'string' ? body.query : '',
      variables: body.variables && typeof body.variables === 'object' && !Array.isArray(body.variables)
        ? body.variables
        : {},
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
