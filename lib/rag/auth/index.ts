import { Redis } from '@upstash/redis';

/** Daily question limit for regular users (configurable via env) */
const DAILY_LIMIT = Math.max(1, Number(process.env.RAG_DAILY_LIMIT) || 20);

/** Admin users with unlimited access (GitHub login) */
const ADMIN_USERS = new Set(
  (process.env.ADMIN_GITHUB_USERS ?? 'GalileoL').split(',').map((u) => u.trim().toLowerCase()),
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
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const key = `rag:usage:${login}:${today}`;

  const current = (await r.get<number>(key)) ?? 0;

  if (current >= DAILY_LIMIT) {
    return {
      allowed: false,
      remaining: 0,
      limit: DAILY_LIMIT,
      error: `Daily limit reached (${DAILY_LIMIT} questions/day). Try again tomorrow.`,
    };
  }

  // Increment and set TTL of 48 hours (auto-cleanup)
  await r.incr(key);
  if (current === 0) {
    await r.expire(key, 60 * 60 * 48);
  }

  return {
    allowed: true,
    remaining: DAILY_LIMIT - current - 1,
    limit: DAILY_LIMIT,
  };
}
