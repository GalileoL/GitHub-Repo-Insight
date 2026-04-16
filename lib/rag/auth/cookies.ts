import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const FALLBACK_MAX_AGE_SECONDS = 60 * 15;

/** Decode legacy (unencrypted) cookie payloads during migration. */
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

/** Derive a fixed 32-byte key from the secret for AES-256-GCM. */
function deriveEncryptionKey(): Buffer {
  return createHash('sha256').update(getSigningSecret()).digest();
}

function encrypt(plaintext: string): string {
  const key = deriveEncryptionKey();
  const iv = randomBytes(12); // 96-bit IV for GCM
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag(); // 16 bytes
  // Format: <iv>.<ciphertext>.<authTag>  (all base64url)
  return `${iv.toString('base64url')}.${encrypted.toString('base64url')}.${tag.toString('base64url')}`;
}

function decrypt(sealed: string): string | null {
  const parts = sealed.split('.');
  if (parts.length !== 3) return null;
  try {
    const iv = Buffer.from(parts[0], 'base64url');
    const encrypted = Buffer.from(parts[1], 'base64url');
    const tag = Buffer.from(parts[2], 'base64url');
    if (iv.length !== 12 || tag.length !== 16) return null;

    const key = deriveEncryptionKey();
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}

function sign(value: string): string {
  return createHmac('sha256', getSigningSecret()).update(value).digest('base64url');
}

export function createSignedPayload(payload: Record<string, unknown>): string {
  const sealed = encrypt(JSON.stringify(payload));
  return `${sealed}.${sign(sealed)}`;
}

/**
 * Verify and decrypt a signed+encrypted payload.
 * Also accepts legacy sign-only format for backward compatibility during rollout.
 */
export function verifySignedPayload<T>(value: string | undefined): T | null {
  if (!value) return null;
  const idx = value.lastIndexOf('.');
  if (idx <= 0) return null;

  const body = value.slice(0, idx);
  const signature = value.slice(idx + 1);
  if (!body || !signature) return null;
  const expected = sign(body);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  if (a.length !== b.length) return null;
  try {
    if (!timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }

  // New encrypted format: iv.ciphertext.tag (3 dot-separated parts in body)
  const dotCount = body.split('.').length - 1;
  if (dotCount === 2) {
    const plaintext = decrypt(body);
    if (!plaintext) return null;
    try {
      return JSON.parse(plaintext) as T;
    } catch {
      return null;
    }
  }

  // Legacy unencrypted format: base64url payload (no dots in body)
  try {
    const decoded = base64UrlDecode(body);
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
