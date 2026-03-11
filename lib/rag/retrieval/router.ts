import type { QueryCategory, ChunkType } from '../types.js';

/** Simple keyword-based query router */
export function classifyQuery(query: string): {
  category: QueryCategory;
  typeFilter: ChunkType[] | undefined;
} {
  const q = query.toLowerCase();

  // Documentation-oriented
  const docPatterns = [
    'what does', 'what is', 'how to', 'how do', 'install', 'setup', 'getting started',
    'readme', 'documentation', 'purpose', 'about', 'overview', 'introduction',
    'usage', 'example', 'tutorial',
  ];
  if (docPatterns.some((p) => q.includes(p))) {
    return { category: 'documentation', typeFilter: ['readme', 'release'] };
  }

  // Changes-oriented
  const changePatterns = [
    'changed', 'change', 'recent', 'latest', 'new', 'release', 'version',
    'update', 'changelog', 'breaking', 'deprecat', 'migrat',
  ];
  if (changePatterns.some((p) => q.includes(p))) {
    return { category: 'changes', typeFilter: ['commit', 'pr', 'release'] };
  }

  // Community-oriented
  const communityPatterns = [
    'issue', 'bug', 'feature request', 'discussion', 'pr', 'pull request',
    'contributor', 'community', 'theme', 'common', 'frequent', 'popular',
    'most discussed', 'requested',
  ];
  if (communityPatterns.some((p) => q.includes(p))) {
    return { category: 'community', typeFilter: ['issue', 'pr'] };
  }

  // File-oriented (prepared for Phase 2)
  const filePatterns = [
    'file', 'code', 'implement', 'where is', 'which file', 'source',
    'function', 'class', 'module', 'directory', 'folder',
  ];
  if (filePatterns.some((p) => q.includes(p))) {
    return { category: 'general', typeFilter: ['pr', 'commit', 'readme'] };
  }

  // General — no filter, search everything
  return { category: 'general', typeFilter: undefined };
}
