import { describe, it, expect } from 'vitest';
import { buildContextText, buildMessagesFromContext, buildSources } from '../../../../../lib/rag/llm/index.js';
import type { ScoredChunk } from '../../../../../lib/rag/types.js';

describe('buildContextText', () => {
  it('formats chunks into a stable prompt context', () => {
    const chunks: ScoredChunk[] = [
      {
        chunk: {
          id: 'c1',
          content: 'chunk body',
          metadata: {
            repo: 'owner/repo',
            type: 'readme',
            title: 'README',
            githubUrl: 'https://example.com/readme',
          },
        },
        score: 0.9,
      },
    ];

    const context = buildContextText(chunks);

    expect(context).toContain('[Source 1] README (readme) — https://example.com/readme');
    expect(context).toContain('chunk body');
  });
});

describe('buildMessagesFromContext', () => {
  it('adds a continuation assistant message when resuming', () => {
    const messages = buildMessagesFromContext(
      'How does resume work?',
      'owner/repo',
      'stored context',
      'analytics prefix\n',
      'previous partial answer',
    );

    expect(messages).toHaveLength(4);
    expect(messages[1].content).toContain('analytics prefix');
    expect(messages[1].content).toContain('stored context');
    expect(messages[2]).toEqual({ role: 'assistant', content: 'previous partial answer' });
    expect(messages[3].content).toContain('Continue from the exact next character');
    expect(messages[3].content).toContain('same language as the original question');
  });
});

describe('buildSources', () => {
  it('keeps allowed URLs', () => {
    const chunks: ScoredChunk[] = [
      {
        chunk: {
          id: 'c1',
          content: 'body',
          metadata: {
            repo: 'owner/repo',
            type: 'issue',
            title: 'Issue 1',
            githubUrl: 'https://github.com/owner/repo/issues/1',
          },
        },
        score: 0.8,
      },
    ];

    const sources = buildSources(chunks);

    expect(sources).toHaveLength(1);
    expect(sources[0].url).toBe('https://github.com/owner/repo/issues/1');
  });

  it('drops unsafe URLs from sources', () => {
    const chunks: ScoredChunk[] = [
      {
        chunk: {
          id: 'c2',
          content: 'body',
          metadata: {
            repo: 'owner/repo',
            type: 'readme',
            title: 'README',
            githubUrl: 'javascript:alert(1)',
          },
        },
        score: 0.7,
      },
    ];

    const sources = buildSources(chunks);

    expect(sources).toHaveLength(1);
    expect(sources[0].url).toBe('');
  });
});
