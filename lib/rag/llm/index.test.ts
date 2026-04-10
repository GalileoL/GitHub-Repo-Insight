import { describe, it, expect } from 'vitest';
import { buildContextText, buildMessagesFromContext } from './index.js';
import type { ScoredChunk } from '../types.js';

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
    expect(messages[3].content).toContain('Continue the answer from the exact next character');
  });
});
