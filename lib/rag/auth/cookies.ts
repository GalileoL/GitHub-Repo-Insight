import { createHmac, randomBytes } from 'node:crypto';

const FALLBACK_MAX_AGE_SECONDS = 60 * 15;

function base64UrlEncode(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

function base64UrlDecode(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8');
}

function getSigningSecret(): string {
  const secret = process.env.AUTH_SESSION_SECRET;
  if (!secret) {
    throw new Error('Missing AUTH_SESSION_SECRET for signing auth cookies.');
  }
  return secret;
}

function sign(value: string): string {
  return createHmac('sha256', getSigningSecret()).update(value).digest('base64url');
}

export function createSignedPayload(payload: Record<string, unknown>): string {
  const encoded = base64UrlEncode(JSON.stringify(payload));
  return `${encoded}.${sign(encoded)}`;
}

export function verifySignedPayload<T>(value: string | undefined): T | null {
  if (!value) return null;
  const idx = value.lastIndexOf('.');
  if (idx <= 0) return null;

  const encoded = value.slice(0, idx);
  const signature = value.slice(idx + 1);
  if (!encoded || !signature) return null;
  if (sign(encoded) !== signature) return null;

  try {
    const decoded = base64UrlDecode(encoded);
    return JSON.parse(decoded) as T;
  } catch {
    return null;
  }
}

export function parseCookieHeader(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) return {};

  const out: Record<string, string> = {};
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const raw = part.slice(idx + 1).trim();
    if (!key || !raw) continue;

    try {
      out[key] = decodeURIComponent(raw);
    } catch {
      out[key] = raw;
    }
  }
  return out;
}

function isProdLikeEnv(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';
}

export function buildSetCookie(name: string, value: string, maxAgeSeconds = FALLBACK_MAX_AGE_SECONDS): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
  ];

  if (isProdLikeEnv()) {
    parts.push('Secure');
  }

  return parts.join('; ');
}

export function buildClearCookie(name: string): string {
  const parts = [
    `${name}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ];

  if (isProdLikeEnv()) {
    parts.push('Secure');
  }

  return parts.join('; ');
}

export function randomUrlSafeString(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}
