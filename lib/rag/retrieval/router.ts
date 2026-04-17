import type { QueryCategory, ChunkType } from '../types.js';

/** Simple keyword-based query router */
export function classifyQuery(query: string): {
  category: QueryCategory;
  typeFilter: ChunkType[] | undefined;
} {
  const q = query.toLowerCase();

  const explicitCodeLookupPatterns = [
    /\bwhere is\b/,
    /\bwhich file\b/,
    /\bsource code\b/,
    /\bwhat file\b/,
    /\bwhich module\b/,
    /\bwhich function\b/,
    /\bwhich class\b/,
    /\bwhich directory\b/,
    /\bwhich folder\b/,
    /\bwhich handler\b/,
    /\bwhich hook\b/,
    /\bwhich component\b/,
    /\bwhere (?:do|does|is)\b.*\b(?:implement|defined|live|located)\b/,
  ];
  if (explicitCodeLookupPatterns.some((pattern) => pattern.test(q))) {
    return { category: 'code', typeFilter: ['code_summary', 'pr', 'commit', 'readme'] };
  }

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

  // Code-oriented
  const codePatterns = [
    'file', 'code', 'implement',
  ];
  if (codePatterns.some((p) => q.includes(p))) {
    return { category: 'code', typeFilter: ['code_summary', 'pr', 'commit', 'readme'] };
  }

  // General — no filter, search everything
  return { category: 'general', typeFilter: undefined };
}
