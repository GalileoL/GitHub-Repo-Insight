import { describe, it, expect } from 'vitest';
import { parseAnalyticsQuery } from '../../../../../lib/rag/intents/parse-analytics.js';

describe('parseAnalyticsQuery', () => {
  // ── Entity detection ──

  it('detects PR entity', () => {
    const r = parseAnalyticsQuery('count merged pull requests');
    expect(r?.entity).toBe('pr');
  });

  it('detects issue entity', () => {
    const r = parseAnalyticsQuery('how many issues?');
    expect(r?.entity).toBe('issue');
  });

  it('detects commit entity', () => {
    const r = parseAnalyticsQuery('how many commits?');
    expect(r?.entity).toBe('commit');
  });

  it('returns null when no entity', () => {
    expect(parseAnalyticsQuery('how many stars?')).toBeNull();
  });

  // ── State extraction ──

  it('extracts merged state for PRs', () => {
    const r = parseAnalyticsQuery('merged PRs');
    expect(r?.state).toBe('merged');
  });

  it('extracts open state', () => {
    const r = parseAnalyticsQuery('open issues');
    expect(r?.state).toBe('open');
  });

  it('extracts closed state', () => {
    const r = parseAnalyticsQuery('closed issues');
    expect(r?.state).toBe('closed');
  });

  it('defaults to all', () => {
    const r = parseAnalyticsQuery('all PRs');
    expect(r?.state).toBe('all');
  });

  // ── Chinese state ──

  it('extracts merged state from Chinese', () => {
    const r = parseAnalyticsQuery('合并了多少PR');
    expect(r?.state).toBe('merged');
  });

  it('keeps commit state as all even if merged wording is present', () => {
    const r = parseAnalyticsQuery('how many merged commits in Q1 2024');
    expect(r?.entity).toBe('commit');
    expect(r?.state).toBe('all');
  });

  // ── Date range: Chinese month range ──

  it('parses Chinese month range with year', () => {
    const r = parseAnalyticsQuery('2024年1月到6月');
    expect(r).toBeNull(); // no entity
  });

  it('parses Chinese month range with year + entity', () => {
    const r = parseAnalyticsQuery('2024年1月到6月有多少PR');
    expect(r?.dateRange).toEqual({
      since: '2024-01-01T00:00:00Z',
      until: '2024-06-30T23:59:59Z',
    });
  });

  // ── Date range: Chinese year ──

  it('parses Chinese year only', () => {
    const r = parseAnalyticsQuery('2024年的PR');
    expect(r?.dateRange).toEqual({
      since: '2024-01-01T00:00:00Z',
      until: '2024-12-31T23:59:59Z',
    });
  });

  // ── Date range: English ──

  it('parses English month range', () => {
    const r = parseAnalyticsQuery('PRs between January and March 2024');
    expect(r?.dateRange).toEqual({
      since: '2024-01-01T00:00:00Z',
      until: '2024-03-31T23:59:59Z',
    });
  });

  it('parses English quarter', () => {
    const r = parseAnalyticsQuery('commits in Q2 2024');
    expect(r?.dateRange).toEqual({
      since: '2024-04-01T00:00:00Z',
      until: '2024-06-30T23:59:59Z',
    });
  });

  it('parses "in 2024"', () => {
    const r = parseAnalyticsQuery('issues in 2024');
    expect(r?.dateRange).toEqual({
      since: '2024-01-01T00:00:00Z',
      until: '2024-12-31T23:59:59Z',
    });
  });

  it('parses single English month', () => {
    const r = parseAnalyticsQuery('PRs in March 2024');
    expect(r?.dateRange).toEqual({
      since: '2024-03-01T00:00:00Z',
      until: '2024-03-31T23:59:59Z',
    });
  });

  // ── Date range: relative ──

  it('parses "last 3 months"', () => {
    const r = parseAnalyticsQuery('PRs in last 3 months');
    expect(r?.dateRange).not.toBeNull();
    expect(r?.dateRange?.since).toBeDefined();
    expect(r?.dateRange?.until).toBeDefined();
  });

  it('parses Chinese relative months', () => {
    const r = parseAnalyticsQuery('过去6个月的PR');
    expect(r?.dateRange).not.toBeNull();
  });

  // ── Op extraction ──

  it('detects top_authors op', () => {
    const r = parseAnalyticsQuery('top PR authors');
    expect(r?.op).toBe('top_authors');
  });

  it('defaults to count op', () => {
    const r = parseAnalyticsQuery('how many PRs?');
    expect(r?.op).toBe('count');
  });

  // ── Edge cases: invalid month values ──

  it('returns null dateRange for invalid months (13月)', () => {
    const r = parseAnalyticsQuery('13月到15月的PR');
    expect(r?.entity).toBe('pr');
    expect(r?.dateRange).toBeNull();
  });

  it('returns null dateRange for month 0', () => {
    const r = parseAnalyticsQuery('2024年0月的issue');
    expect(r?.entity).toBe('issue');
    expect(r?.dateRange).toBeNull();
  });
});
