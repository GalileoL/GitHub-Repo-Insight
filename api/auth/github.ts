import type { VercelRequest, VercelResponse } from '@vercel/node';
import { buildClearCookie, parseCookieHeader, verifySignedPayload } from '../../lib/rag/auth/cookies.js';
import { establishGitHubSession } from '../../lib/rag/auth/index.js';

const OAUTH_FLOW_COOKIE = 'gh_oauth_flow';
const OAUTH_CODE_TTL_MS = 10 * 60 * 1000;

interface OAuthFlowPayload {
  state: string;
  codeVerifier: string;
  returnTo: string;
  createdAt: number;
}

interface OAuthTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
  error?: string;
  error_description?: string;
}

function inferOrigin(req: VercelRequest): string {
  const host = req.headers.host;
  if (!host) {
    throw new Error('Missing host header');
  }
  const isLocalHost = host.startsWith('localhost:') || host.startsWith('127.0.0.1:');
  const proto = isLocalHost ? 'http' : 'https';
  return `${proto}://${host}`;
}

function resolveCallbackUrl(req: VercelRequest): string {
  if (process.env.GITHUB_AUTH_CALLBACK_URL) {
    return process.env.GITHUB_AUTH_CALLBACK_URL;
  }
  return `${inferOrigin(req)}/auth/callback`;
}

function resolveClientId(): string {
  return process.env.GITHUB_APP_CLIENT_ID || process.env.GITHUB_CLIENT_ID || '';
}

function resolveClientSecret(): string {
  return process.env.GITHUB_APP_CLIENT_SECRET || process.env.GITHUB_CLIENT_SECRET || '';
}

function readFlowPayload(req: VercelRequest): OAuthFlowPayload | null {
  const cookies = parseCookieHeader(req.headers.cookie);
  return verifySignedPayload<OAuthFlowPayload>(cookies[OAUTH_FLOW_COOKIE]);
}

function appendSetCookie(res: VercelResponse, cookie: string): void {
  const existing = res.getHeader('Set-Cookie');
  if (!existing) {
    res.setHeader('Set-Cookie', cookie);
    return;
  }

  if (Array.isArray(existing)) {
    res.setHeader('Set-Cookie', [...existing, cookie]);
    return;
  }

  res.setHeader('Set-Cookie', [String(existing), cookie]);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const clientId = resolveClientId();
  const clientSecret = resolveClientSecret();
  if (!clientId || !clientSecret) {
    return res.status(500).json({ error: 'Missing GitHub App OAuth credentials.' });
  }

  const { code, state } = req.body ?? {};

  if (!code || !state || typeof code !== 'string' || typeof state !== 'string') {
    return res.status(400).json({ error: 'Missing code or state parameter' });
  }

  const flowPayload = readFlowPayload(req);
  if (!flowPayload) {
    return res.status(400).json({ error: 'Missing OAuth flow state. Please start sign-in again.' });
  }

  const stateExpired = Date.now() - flowPayload.createdAt > OAUTH_CODE_TTL_MS;
  if (flowPayload.state !== state || stateExpired) {
    appendSetCookie(res, buildClearCookie(OAUTH_FLOW_COOKIE));
    return res.status(400).json({ error: 'Invalid or expired OAuth state. Please sign in again.' });
  }

  try {
    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        state,
        redirect_uri: resolveCallbackUrl(req),
        code_verifier: flowPayload.codeVerifier,
      }),
    });

    const data = (await response.json()) as OAuthTokenResponse;

    if (data.error) {
      return res.status(400).json({ error: data.error_description || data.error });
    }

    if (!data.access_token) {
      return res.status(400).json({ error: 'GitHub did not return an access token.' });
    }

    const userRes = await fetch('https://api.github.com/user', {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${data.access_token}`,
      },
    });

    if (!userRes.ok) {
      return res.status(400).json({ error: 'Failed to verify GitHub user profile.' });
    }

    const user = (await userRes.json()) as { login: string; id: number; avatar_url: string };
    if (!user.login || !user.id || !user.avatar_url) {
      return res.status(400).json({ error: 'GitHub user profile is incomplete.' });
    }

    await establishGitHubSession(res, data, user);
    appendSetCookie(res, buildClearCookie(OAUTH_FLOW_COOKIE));

    return res.status(200).json({
      user: {
        login: user.login,
        avatar_url: user.avatar_url,
      },
      returnTo: flowPayload.returnTo || '/',
    });
  } catch {
    return res.status(500).json({ error: 'Token exchange failed' });
  }
}
