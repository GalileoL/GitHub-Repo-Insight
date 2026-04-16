const DEFAULT_ALLOWED_ORIGIN_PATTERNS = [
  'https://github.com',
  'https://*.github.com',
  'https://raw.githubusercontent.com',
  'https://*.githubusercontent.com',
  'https://*.githubassets.com',
];

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if ((code >= 0 && code <= 31) || code === 127) {
      return true;
    }
  }
  return false;
}

function toPatternRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '[^/]*');
  return new RegExp(`^${escaped}$`, 'i');
}

export function getAllowedOriginPatterns(raw?: string): string[] {
  const parsed = (raw ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  return parsed.length > 0 ? parsed : DEFAULT_ALLOWED_ORIGIN_PATTERNS;
}

export function getRuntimeAllowedOriginPatterns(): string[] {
  return getAllowedOriginPatterns(import.meta.env.VITE_ALLOWED_URL_ORIGIN_PATTERNS);
}

export function isAllowedHttpUrl(rawUrl: string, allowedOriginPatterns: string[]): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  if (hasControlChars(rawUrl)) return false;

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) return false;
  if (parsed.username || parsed.password) return false;

  const origin = parsed.origin;
  const hostname = parsed.hostname;

  return allowedOriginPatterns.some((pattern) => {
    const isOriginPattern = pattern.includes('://');
    const valueToCheck = isOriginPattern ? origin : hostname;
    return toPatternRegex(pattern).test(valueToCheck);
  });
}
