import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash } from 'node:crypto';
import { buildSetCookie, createSignedPayload, randomUrlSafeString } from '../../lib/rag/auth/cookies.js';

const OAUTH_FLOW_COOKIE = 'gh_oauth_flow';
const OAUTH_FLOW_MAX_AGE_SECONDS = 60 * 10;

interface OAuthFlowPayload {
  state: string;
  codeVerifier: string;
  returnTo: string;
  createdAt: number;
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

function toCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

function sanitizeReturnTo(input: string | string[] | undefined): string {
  const value = Array.isArray(input) ? input[0] : input;
  if (!value || !value.startsWith('/')) return '/';
  if (value.startsWith('//')) return '/';
  return value;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const clientId = resolveClientId();
  if (!clientId) {
    return res.status(500).json({ error: 'Missing GITHUB_APP_CLIENT_ID (or GITHUB_CLIENT_ID).' });
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
