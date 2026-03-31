import { describe, it, expect } from 'vitest';
import { classifyIntent } from './classify-intent.js';

describe('classifyIntent', () => {
  // ── repo_analytics ──

  it('detects English PR count question', () => {
    const r = classifyIntent('How many PRs were merged in the last 3 months?');
    expect(r.intent).toBe('repo_analytics');
    expect(r.analyticsQuery?.entity).toBe('pr');
    expect(r.analyticsQuery?.state).toBe('merged');
    expect(r.analyticsQuery?.op).toBe('count');
  });

  it('detects Chinese PR count question', () => {
    const r = classifyIntent('2024年1月到6月之间合并了多少个PR？');
    expect(r.intent).toBe('repo_analytics');
    expect(r.analyticsQuery?.entity).toBe('pr');
    expect(r.analyticsQuery?.state).toBe('merged');
    expect(r.analyticsQuery?.dateRange?.since).toBe('2024-01-01T00:00:00Z');
    expect(r.analyticsQuery?.dateRange?.until).toBe('2024-06-30T23:59:59Z');
  });

  it('detects issue count question', () => {
    const r = classifyIntent('How many open issues are there?');
    expect(r.intent).toBe('repo_analytics');
    expect(r.analyticsQuery?.entity).toBe('issue');
    expect(r.analyticsQuery?.state).toBe('open');
  });

  it('detects commit count with quarter', () => {
    const r = classifyIntent('How many commits in Q1 2024?');
    expect(r.intent).toBe('repo_analytics');
    expect(r.analyticsQuery?.entity).toBe('commit');
    expect(r.analyticsQuery?.dateRange?.since).toBe('2024-01-01T00:00:00Z');
    expect(r.analyticsQuery?.dateRange?.until).toBe('2024-03-31T23:59:59Z');
  });

  it('detects top authors question', () => {
    const r = classifyIntent('Who are the top PR contributors?');
    expect(r.intent).toBe('repo_analytics');
    expect(r.analyticsQuery?.op).toBe('top_authors');
    expect(r.analyticsQuery?.entity).toBe('pr');
  });

  // ── hybrid_analytics_qa ──

  it('detects hybrid when count + explanation requested', () => {
    const r = classifyIntent('How many issues were opened last 3 months and what are the common themes?');
    expect(r.intent).toBe('hybrid_analytics_qa');
    expect(r.analyticsQuery?.entity).toBe('issue');
  });

  it('detects hybrid with Chinese explanation signals', () => {
    const r = classifyIntent('总共有多少个PR？主要是关于什么的？');
    expect(r.intent).toBe('hybrid_analytics_qa');
    expect(r.analyticsQuery?.entity).toBe('pr');
  });

  // ── semantic_qa ──

  it('falls through to semantic_qa for explanation questions', () => {
    const r = classifyIntent('How do I install this package?');
    expect(r.intent).toBe('semantic_qa');
    expect(r.analyticsQuery).toBeNull();
  });

  it('falls through to semantic_qa for architecture questions', () => {
    const r = classifyIntent('What is the project structure?');
    expect(r.intent).toBe('semantic_qa');
    expect(r.analyticsQuery).toBeNull();
  });

  it('falls through when no entity is found', () => {
    const r = classifyIntent('How many stars does this repo have?');
    expect(r.intent).toBe('semantic_qa');
    expect(r.analyticsQuery).toBeNull();
  });
});
