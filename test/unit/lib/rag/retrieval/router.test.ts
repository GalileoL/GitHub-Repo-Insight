import { describe, expect, it } from 'vitest';
import { classifyQuery } from '../../../../../lib/rag/retrieval/router.js';

describe('classifyQuery', () => {
  it('routes documentation questions to readme/release chunks', () => {
    expect(classifyQuery('How do I install this project?')).toEqual({
      category: 'documentation',
      typeFilter: ['readme', 'release'],
    });
  });

  it('routes change questions to commit/pr/release chunks', () => {
    expect(classifyQuery('What changed in the latest release?')).toEqual({
      category: 'changes',
      typeFilter: ['commit', 'pr', 'release'],
    });
  });

  it('routes community questions to issue/pr chunks', () => {
    expect(classifyQuery('What are the most common issues people report?')).toEqual({
      category: 'community',
      typeFilter: ['issue', 'pr'],
    });
  });

  it('routes code lookup questions to code_summary path', () => {
    expect(classifyQuery('Where is the retry handler implemented?')).toEqual({
      category: 'code',
      typeFilter: ['code_summary', 'pr', 'commit', 'readme'],
    });
  });

  it('prefers code routing over community terms when file lookup intent is explicit', () => {
    expect(classifyQuery('Which file handles pull requests?')).toEqual({
      category: 'code',
      typeFilter: ['code_summary', 'pr', 'commit', 'readme'],
    });
  });

  it('prefers code routing over change terms when asking about a source module', () => {
    expect(classifyQuery('Which module changed the auth token refresh flow?')).toEqual({
      category: 'code',
      typeFilter: ['code_summary', 'pr', 'commit', 'readme'],
    });
  });

  it('keeps documentation intent ahead of generic import/export wording', () => {
    expect(classifyQuery('How do I import this package?')).toEqual({
      category: 'documentation',
      typeFilter: ['readme', 'release'],
    });
  });

  it('does not confuse important/classic substrings with import/class code cues', () => {
    expect(classifyQuery('What are the most important changes in the latest release?')).toEqual({
      category: 'changes',
      typeFilter: ['commit', 'pr', 'release'],
    });
    expect(classifyQuery('What changed in the classic theme release?')).toEqual({
      category: 'changes',
      typeFilter: ['commit', 'pr', 'release'],
    });
  });

  it('falls back to general when no route-specific intent is present', () => {
    expect(classifyQuery('Summarize this repository for me')).toEqual({
      category: 'general',
      typeFilter: undefined,
    });
  });
});
