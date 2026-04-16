import { describe, expect, it } from 'vitest';
import { getAllowedOriginPatterns, isAllowedHttpUrl } from '../../../../src/utils/url-safety';

describe('url safety', () => {
  it('uses defaults when no runtime config is provided', () => {
    const patterns = getAllowedOriginPatterns(undefined);

    expect(patterns.length).toBeGreaterThan(0);
    expect(patterns).toContain('https://github.com');
  });

  it('allows https URLs that match the configured allowlist', () => {
    const allowed = ['https://github.com', 'https://*.githubusercontent.com'];

    expect(isAllowedHttpUrl('https://github.com/owner/repo', allowed)).toBe(true);
    expect(isAllowedHttpUrl('https://avatars.githubusercontent.com/u/1', allowed)).toBe(true);
  });

  it('blocks non-http protocols and off-list hosts', () => {
    const allowed = ['https://github.com'];

    expect(isAllowedHttpUrl('javascript:alert(1)', allowed)).toBe(false);
    expect(isAllowedHttpUrl('https://example.com/path', allowed)).toBe(false);
  });
});
