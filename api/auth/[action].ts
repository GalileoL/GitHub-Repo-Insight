import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash } from 'node:crypto';
import {
  buildClearCookie,
  buildSetCookie,
  createSignedPayload,
  parseCookieHeader,
  randomUrlSafeString,
  verifySignedPayload,
} from '../../lib/rag/auth/cookies.js';
import {
  clearGitHubSession,
  establishGitHubSession,
  getSessionUser,
  logAuthEvent,
} from '../../lib/rag/auth/index.js';

const OAUTH_FLOW_COOKIE = 'gh_oauth_flow';
const OAUTH_FLOW_MAX_AGE_SECONDS = 60 * 10;
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
  return process.env.GITHUB_APP_CLIENT_ID || '';
}

function resolveClientSecret(): string {
  return process.env.GITHUB_APP_CLIENT_SECRET || '';
}

function toCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

function sanitizeReturnTo(input: string | string[] | undefined): string {
  const value = Array.isArray(input) ? input[0] : input;
  if (!value || !value.startsWith('/')) return '/';
  if (value.startsWith('//')) return '/';
  return value;
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

function resolveAction(req: VercelRequest): string {
  const value = req.query.action;
  return Array.isArray(value) ? value[0] ?? '' : typeof value === 'string' ? value : '';
}

async function handleStart(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const clientId = resolveClientId();
  if (!clientId) {
    return res.status(500).json({ error: 'Missing GITHUB_APP_CLIENT_ID.' });
  }

  const callbackUrl = resolveCallbackUrl(req);
  const state = randomUrlSafeString(24);
  const codeVerifier = randomUrlSafeString(48);
  const payload: OAuthFlowPayload = {
    state,
    codeVerifier,
    returnTo: sanitizeReturnTo(req.query.returnTo),
    createdAt: Date.now(),
  };

  const signedPayload = createSignedPayload(payload as unknown as Record<string, unknown>);
  res.setHeader('Set-Cookie', buildSetCookie(OAUTH_FLOW_COOKIE, signedPayload, OAUTH_FLOW_MAX_AGE_SECONDS));

  const authorizeUrl = new URL('https://github.com/login/oauth/authorize');
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('redirect_uri', callbackUrl);
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('code_challenge', toCodeChallenge(codeVerifier));
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');

  return res.redirect(302, authorizeUrl.toString());
}

async function handleGithub(req: VercelRequest, res: VercelResponse) {
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
    logAuthEvent(req, 'login', { login: user.login });

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

async function handleSession(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'private, no-store');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = getSessionUser(req);
  if (!user) {
    return res.status(200).json({ authenticated: false, user: null });
  }

  return res.status(200).json({ authenticated: true, user });
}

async function handleLogout(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  await clearGitHubSession(req, res);
  return res.status(200).json({ ok: true });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const action = resolveAction(req);

  switch (action) {
    case 'start':
      return handleStart(req, res);
    case 'github':
      return handleGithub(req, res);
    case 'session':
      return handleSession(req, res);
    case 'logout':
      return handleLogout(req, res);
    default:
      return res.status(404).json({ error: 'Not found' });
  }
}
