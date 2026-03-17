import { Redis } from '@upstash/redis';

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
