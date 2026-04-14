import { Redis } from '@upstash/redis';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  buildSetCookie,
  buildClearCookie,
  createSignedPayload,
  parseCookieHeader,
  verifySignedPayload,
} from './cookies.js';

/** Daily question limit for regular users (configurable via env) */
const DAILY_LIMIT = Math.max(1, Number(process.env.RAG_DAILY_LIMIT) || 20);

/** Daily ingest (index) limit for regular users (configurable via env) */
const DAILY_INGEST_LIMIT = Math.max(1, Number(process.env.RAG_DAILY_INGEST_LIMIT) || 5);

/** Admin users with unlimited access (GitHub login) */
const ADMIN_USERS = new Set(
  (process.env.ADMIN_GITHUB_USERS ?? '')
    .split(',')
    .map((u) => u.trim().toLowerCase())
    .filter((u) => u.length > 0),
);

let redis: Redis | null = null;

const GITHUB_SESSION_COOKIE = 'gh_app_session';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

interface GitHubSessionPayload {
  token: string;
  refreshToken?: string;
  tokenExpiresAt?: number;
  refreshTokenExpiresAt?: number;
  login: string;
  userId: number;
  avatarUrl: string;
  issuedAt: number;
}

function getRedis(): Redis {
  if (!redis) {
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    });
  }
  return redis;
}

export interface AuthResult {
  authenticated: boolean;
  login?: string;
  isAdmin?: boolean;
  error?: string;
}

export interface SessionUser {
  login: string;
  id: number;
  avatar_url: string;
}

export interface AuthenticatedRequestResult extends AuthResult {
  token?: string;
}

function getGitHubAppClientId(): string {
  return process.env.GITHUB_APP_CLIENT_ID || '';
}

function getGitHubAppClientSecret(): string {
  return process.env.GITHUB_APP_CLIENT_SECRET || '';
}

function parsePositiveSeconds(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.floor(value);
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  }
  return undefined;
}

function extractBearerToken(headerValue: string | undefined): string | undefined {
  const token = (headerValue ?? '').replace(/^Bearer\s+/i, '').trim();
  return token || undefined;
}

function parseSessionCookie(req: VercelRequest): GitHubSessionPayload | null {
  const cookies = parseCookieHeader(req.headers.cookie);
  const payload = verifySignedPayload<GitHubSessionPayload>(cookies[GITHUB_SESSION_COOKIE]);
  if (!payload) return null;
  if (!payload.token || !payload.login || !payload.userId || !payload.avatarUrl) return null;
  if (!Number.isFinite(payload.issuedAt) || payload.issuedAt <= 0) return null;

  if (payload.refreshTokenExpiresAt && Date.now() > payload.refreshTokenExpiresAt) {
    return null;
  }

  return payload;
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

function setSessionCookie(res: VercelResponse, payload: GitHubSessionPayload): void {
  const signed = createSignedPayload(payload as unknown as Record<string, unknown>);
  appendSetCookie(res, buildSetCookie(GITHUB_SESSION_COOKIE, signed, SESSION_MAX_AGE_SECONDS));
}

export function clearGitHubSession(res: VercelResponse): void {
  appendSetCookie(res, buildClearCookie(GITHUB_SESSION_COOKIE));
}

export function getSessionUser(req: VercelRequest): SessionUser | null {
  const payload = parseSessionCookie(req);
  if (!payload) return null;
  return {
    login: payload.login,
    id: payload.userId,
    avatar_url: payload.avatarUrl,
  };
}

interface OAuthTokenExchangeResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
}

export async function establishGitHubSession(
  res: VercelResponse,
  tokenResponse: OAuthTokenExchangeResponse,
  user: { login: string; id: number; avatar_url: string },
): Promise<void> {
  if (!tokenResponse.access_token) {
    throw new Error('Missing access token in OAuth token response.');
  }

  const now = Date.now();
  const expiresIn = parsePositiveSeconds(tokenResponse.expires_in);
  const refreshExpiresIn = parsePositiveSeconds(tokenResponse.refresh_token_expires_in);
  const payload: GitHubSessionPayload = {
    token: tokenResponse.access_token,
    refreshToken: tokenResponse.refresh_token,
    tokenExpiresAt: expiresIn ? now + expiresIn * 1000 : undefined,
    refreshTokenExpiresAt: refreshExpiresIn ? now + refreshExpiresIn * 1000 : undefined,
    login: user.login,
    userId: user.id,
    avatarUrl: user.avatar_url,
    issuedAt: now,
  };

  setSessionCookie(res, payload);
}

async function refreshGitHubAccessToken(refreshToken: string): Promise<OAuthTokenExchangeResponse | null> {
  const clientId = getGitHubAppClientId();
  const clientSecret = getGitHubAppClientSecret();
  if (!clientId || !clientSecret) return null;

  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) return null;
  const body = (await response.json()) as OAuthTokenExchangeResponse & { error?: string };
  if (body.error || !body.access_token) return null;
  return body;
}

function shouldAttemptRefresh(payload: GitHubSessionPayload): boolean {
  if (!payload.refreshToken) return false;
  if (!payload.tokenExpiresAt) return false;
  return Date.now() >= payload.tokenExpiresAt - 60_000;
}

async function getTokenFromRequest(req: VercelRequest, res: VercelResponse): Promise<string | undefined> {
  const bearerToken = extractBearerToken(req.headers.authorization);
  if (bearerToken) return bearerToken;

  const session = parseSessionCookie(req);
  if (!session) return undefined;

  if (!shouldAttemptRefresh(session)) {
    return session.token;
  }

  const refreshed = await refreshGitHubAccessToken(session.refreshToken!);
  if (!refreshed?.access_token) {
    if (session.tokenExpiresAt && Date.now() > session.tokenExpiresAt) {
      clearGitHubSession(res);
      return undefined;
    }
    return session.token;
  }

  const now = Date.now();
  const expiresIn = parsePositiveSeconds(refreshed.expires_in);
  const refreshExpiresIn = parsePositiveSeconds(refreshed.refresh_token_expires_in);
  const nextSession: GitHubSessionPayload = {
    ...session,
    token: refreshed.access_token,
    refreshToken: refreshed.refresh_token ?? session.refreshToken,
    tokenExpiresAt: expiresIn ? now + expiresIn * 1000 : session.tokenExpiresAt,
    refreshTokenExpiresAt: refreshExpiresIn
      ? now + refreshExpiresIn * 1000
      : session.refreshTokenExpiresAt,
    issuedAt: now,
  };

  setSessionCookie(res, nextSession);
  return nextSession.token;
}

/** Verify a GitHub token and return the user login */
export async function verifyGitHubToken(token: string | undefined): Promise<AuthResult> {
  if (!token) {
    return { authenticated: false, error: 'Authentication required. Please sign in with GitHub.' };
  }

  try {
    const res = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
      },
    });

    if (!res.ok) {
      return { authenticated: false, error: 'Invalid or expired GitHub token. Please sign in again.' };
    }

    const user = (await res.json()) as { login: string };
    const login = user.login;
    const isAdmin = ADMIN_USERS.has(login.toLowerCase());

    return { authenticated: true, login, isAdmin };
  } catch {
    return { authenticated: false, error: 'Failed to verify authentication.' };
  }
}

export async function authenticateRequest(req: VercelRequest, res: VercelResponse): Promise<AuthenticatedRequestResult> {
  const token = await getTokenFromRequest(req, res);
  const auth = await verifyGitHubToken(token);
  if (!auth.authenticated) {
    return auth;
  }

  return {
    ...auth,
    token,
  };
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  error?: string;
}

/** Check and increment the daily usage counter for a user */
export async function checkRateLimit(login: string): Promise<RateLimitResult> {
  // Admin users are unlimited
  if (ADMIN_USERS.has(login.toLowerCase())) {
    return { allowed: true, remaining: Infinity, limit: Infinity };
  }

  const r = getRedis();
  const normalizedLogin = login.toLowerCase();
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const key = `rag:usage:${normalizedLogin}:${today}`;

  // INCR-first flow avoids race conditions from separate GET + INCR reads.
  const next = await r.incr(key);
  if (next === 1) {
    await r.expire(key, 60 * 60 * 48);
  }

  if (next > DAILY_LIMIT) {
    return {
      allowed: false,
      remaining: 0,
      limit: DAILY_LIMIT,
      error: `Daily limit reached (${DAILY_LIMIT} questions/day). Try again tomorrow.`,
    };
  }

  return {
    allowed: true,
    remaining: DAILY_LIMIT - next,
    limit: DAILY_LIMIT,
  };
}

/** Check and increment the daily ingest counter for a user */
export async function checkIngestRateLimit(login: string): Promise<RateLimitResult> {
  if (ADMIN_USERS.has(login.toLowerCase())) {
    return { allowed: true, remaining: Infinity, limit: Infinity };
  }

  const r = getRedis();
  const normalizedLogin = login.toLowerCase();
  const today = new Date().toISOString().slice(0, 10);
  const key = `rag:ingest:${normalizedLogin}:${today}`;

  // INCR-first flow avoids race conditions from separate GET + INCR reads.
  const next = await r.incr(key);
  if (next === 1) {
    await r.expire(key, 60 * 60 * 48);
  }

  if (next > DAILY_INGEST_LIMIT) {
    return {
      allowed: false,
      remaining: 0,
      limit: DAILY_INGEST_LIMIT,
      error: `Daily index limit reached (${DAILY_INGEST_LIMIT}/day). Try again tomorrow.`,
    };
  }

  return {
    allowed: true,
    remaining: DAILY_INGEST_LIMIT - next,
    limit: DAILY_INGEST_LIMIT,
  };
}
