import { describe, it, expect } from 'vitest';
import {
  shouldIndexFile,
  extractTsFacts,
  extractRegexFacts,
  extractCodeFacts,
  renderCodeSummary,
  buildCodeSummaryChunk,
  chunkCodeSummaries,
} from '../../../../../lib/rag/chunking/code-summary.js';

// ═══ shouldIndexFile ════════════════════════════════════════════

describe('shouldIndexFile', () => {
  it('allows files in src/, lib/, api/', () => {
    expect(shouldIndexFile('src/App.tsx')).toBe(true);
    expect(shouldIndexFile('lib/rag/types.ts')).toBe(true);
    expect(shouldIndexFile('api/rag/ask.ts')).toBe(true);
  });

  it('rejects files outside allowed directories', () => {
    expect(shouldIndexFile('docs/readme.md')).toBe(false);
    expect(shouldIndexFile('scripts/build.ts')).toBe(false);
    expect(shouldIndexFile('index.ts')).toBe(false);
  });

  it('rejects test files', () => {
    expect(shouldIndexFile('src/utils/foo.test.ts')).toBe(false);
    expect(shouldIndexFile('lib/rag/bar.spec.ts')).toBe(false);
  });

  it('rejects dist/build/node_modules', () => {
    expect(shouldIndexFile('src/dist/bundle.js')).toBe(false);
    expect(shouldIndexFile('lib/node_modules/foo.ts')).toBe(false);
  });

  it('rejects minified files', () => {
    expect(shouldIndexFile('src/vendor/lib.min.js')).toBe(false);
  });

  it('rejects .d.ts files', () => {
    expect(shouldIndexFile('src/types/global.d.ts')).toBe(false);
  });

  it('rejects files exceeding size limit', () => {
    expect(shouldIndexFile('src/big.ts', 200_000)).toBe(false);
    expect(shouldIndexFile('src/small.ts', 50_000)).toBe(true);
  });

  it('rejects non-source file extensions', () => {
    expect(shouldIndexFile('src/data.json')).toBe(false);
    expect(shouldIndexFile('src/style.css')).toBe(false);
    expect(shouldIndexFile('src/image.png')).toBe(false);
  });

  it('allows Python, Go, Rust, Java, Kotlin', () => {
    expect(shouldIndexFile('src/main.py')).toBe(true);
    expect(shouldIndexFile('src/main.go')).toBe(true);
    expect(shouldIndexFile('src/main.rs')).toBe(true);
    expect(shouldIndexFile('src/Main.java')).toBe(true);
    expect(shouldIndexFile('src/Main.kt')).toBe(true);
  });
});

// ═══ extractTsFacts ═════════════════════════════════════════════

describe('extractTsFacts', () => {
  it('extracts exported functions with signatures', () => {
    const code = `
export function greet(name: string): string {
  return \`Hello \${name}\`;
}

export function farewell(name: string): void {
  console.log(\`Bye \${name}\`);
}
`;
    const facts = extractTsFacts('src/utils.ts', code);
    expect(facts.exports).toContain('greet');
    expect(facts.exports).toContain('farewell');
    expect(facts.symbolSignatures).toHaveLength(2);
    expect(facts.symbolSignatures[0]).toContain('greet');
    expect(facts.symbolSignatures[0]).toContain('name: string');
    expect(facts.language).toBe('typescript');
  });

  it('extracts exported classes with public method signatures', () => {
    const code = `
export class Router {
  public classify(query: string): string { return ''; }
  private internal(): void {}
}
`;
    const facts = extractTsFacts('src/router.ts', code);
    expect(facts.exports).toContain('Router');
    expect(facts.symbolSignatures[0]).toContain('class Router');
    expect(facts.symbolSignatures[0]).toContain('classify');
    expect(facts.symbolSignatures[0]).not.toContain('internal');
  });

  it('extracts exported interfaces and types', () => {
    const code = `
export interface ChunkMetadata {
  repo: string;
  type: string;
}
export type ChunkType = 'readme' | 'code';
`;
    const facts = extractTsFacts('lib/rag/types.ts', code);
    expect(facts.exports).toContain('ChunkMetadata');
    expect(facts.exports).toContain('ChunkType');
  });

  it('extracts import paths', () => {
    const code = `
import { foo } from '../utils.js';
import type { Bar } from './types.js';
`;
    const facts = extractTsFacts('src/index.ts', code);
    expect(facts.importPaths).toContain('../utils.js');
    expect(facts.importPaths).toContain('./types.js');
  });

  it('extracts internal helpers up to limit', () => {
    const helpers = Array.from({ length: 15 }, (_, i) => `function helper${i}() {}`).join('\n');
    const facts = extractTsFacts('src/utils.ts', helpers);
    expect(facts.internalHelpers.length).toBeLessThanOrEqual(10);
  });

  it('extracts leading JSDoc', () => {
    const code = `/** This module handles query routing for RAG retrieval. */
export function classifyQuery() {}
`;
    const facts = extractTsFacts('lib/rag/router.ts', code);
    expect(facts.jsDocSummary).toContain('query routing');
  });

  it('detects route-handler kind hint', () => {
    const code = `export default function handler(req: any, res: any) {}`;
    const facts = extractTsFacts('api/rag/ask.ts', code);
    expect(facts.kindHints).toContain('route-handler');
  });

  it('detects react-hook kind hint', () => {
    const code = `export function useAskRepo() {}`;
    const facts = extractTsFacts('src/hooks/useAskRepo.ts', code);
    expect(facts.kindHints).toContain('react-hook');
  });

  it('detects react-component kind hint for tsx files', () => {
    const code = `export function AnswerCard() { return null; }`;
    const facts = extractTsFacts('src/components/AnswerCard.tsx', code);
    expect(facts.kindHints).toContain('react-component');
  });

  it('extracts export default', () => {
    const code = `export default async function handler() {}`;
    const facts = extractTsFacts('api/rag/ask.ts', code);
    expect(facts.exports).toContain('handler');
  });

  it('extracts re-exports', () => {
    const code = `export { chunkReadme, chunkIssues } from './readme.js';`;
    const facts = extractTsFacts('lib/rag/chunking/index.ts', code);
    expect(facts.exports).toContain('chunkReadme');
    expect(facts.exports).toContain('chunkIssues');
  });

  it('extracts exported const', () => {
    const code = `export const ErrorCategory = { NETWORK: 'network' } as const;`;
    const facts = extractTsFacts('lib/rag/metrics/index.ts', code);
    expect(facts.exports).toContain('ErrorCategory');
  });
});

// ═══ extractRegexFacts ══════════════════════════════════════════

describe('extractRegexFacts', () => {
  it('extracts Python functions and classes', () => {
    const code = `
class MyService:
    pass

def process_data(items):
    pass

async def fetch_remote():
    pass
`;
    const facts = extractRegexFacts('src/service.py', code);
    expect(facts.exports).toContain('MyService');
    expect(facts.exports).toContain('process_data');
    expect(facts.exports).toContain('fetch_remote');
    expect(facts.language).toBe('py');
  });

  it('extracts Go funcs and types', () => {
    const code = `
func HandleRequest(w http.ResponseWriter, r *http.Request) {}
type Config struct {}
type Handler interface {}
`;
    const facts = extractRegexFacts('src/handler.go', code);
    expect(facts.exports).toContain('HandleRequest');
    expect(facts.exports).toContain('Config');
    expect(facts.exports).toContain('Handler');
  });

  it('extracts Python docstring', () => {
    const code = `"""This module provides data processing utilities."""\n\ndef process(): pass`;
    const facts = extractRegexFacts('src/process.py', code);
    expect(facts.jsDocSummary).toContain('data processing');
  });
});

// ═══ extractCodeFacts (unified) ═════════════════════════════════

describe('extractCodeFacts', () => {
  it('routes .ts to AST extractor', () => {
    const facts = extractCodeFacts('src/foo.ts', 'export function foo() {}');
    expect(facts.language).toBe('typescript');
    expect(facts.exports).toContain('foo');
  });

  it('routes .py to regex extractor', () => {
    const facts = extractCodeFacts('src/bar.py', 'def bar(): pass');
    expect(facts.language).toBe('py');
    expect(facts.exports).toContain('bar');
  });
});

// ═══ renderCodeSummary ══════════════════════════════════════════

describe('renderCodeSummary', () => {
  it('renders a semi-structured summary', () => {
    const text = renderCodeSummary({
      filePath: 'lib/rag/retrieval/hybrid.ts',
      language: 'typescript',
      roleHint: 'retrieval',
      exports: ['hybridSearch'],
      symbolSignatures: ['hybridSearch(query: string, repo: string)'],
      internalHelpers: ['addResults'],
      importPaths: ['../types.js', './vector.js'],
      kindHints: ['retrieval'],
      jsDocSummary: 'Hybrid retrieval combining vector + keyword search',
    });

    expect(text).toContain('File: lib/rag/retrieval/hybrid.ts');
    expect(text).toContain('Exports: hybridSearch');
    expect(text).toContain('Symbols: hybridSearch(query: string, repo: string)');
    expect(text).toContain('Imports: ../types.js, ./vector.js');
    expect(text).toContain('Hints: retrieval');
    expect(text).toContain('Helpers: addResults');
    expect(text).toContain('Hybrid retrieval');
  });

  it('omits empty sections', () => {
    const text = renderCodeSummary({
      filePath: 'src/empty.ts',
      language: 'typescript',
      roleHint: null,
      exports: ['foo'],
      symbolSignatures: [],
      internalHelpers: [],
      importPaths: [],
      kindHints: [],
      jsDocSummary: null,
    });

    expect(text).toContain('File: src/empty.ts');
    expect(text).toContain('Exports: foo');
    expect(text).not.toContain('Symbols:');
    expect(text).not.toContain('Imports:');
    expect(text).not.toContain('Hints:');
    expect(text).not.toContain('Helpers:');
    expect(text).not.toContain('Role:');
  });
});

// ═══ buildCodeSummaryChunk ══════════════════════════════════════

describe('buildCodeSummaryChunk', () => {
  it('produces a valid chunk with correct ID and metadata', () => {
    const facts = extractTsFacts('lib/rag/types.ts', 'export interface Chunk { id: string; }');
    const chunk = buildCodeSummaryChunk('owner/repo', facts, 'abc123');

    expect(chunk.id).toBe('owner/repo:code:lib/rag/types.ts');
    expect(chunk.metadata.type).toBe('code_summary');
    expect(chunk.metadata.filePath).toBe('lib/rag/types.ts');
    expect(chunk.metadata.language).toBe('typescript');
    expect(chunk.metadata.lastIndexedSha).toBe('abc123');
    expect(chunk.metadata.symbolNames).toContain('Chunk');
    expect(chunk.content).toContain('File: lib/rag/types.ts');
  });

  it('truncates summary text at hard limit', () => {
    // Generate a file with many exports to create a long summary
    const exports = Array.from({ length: 100 }, (_, i) => `export const var${i} = ${i};`).join('\n');
    const facts = extractTsFacts('src/big.ts', exports);
    const chunk = buildCodeSummaryChunk('owner/repo', facts);

    expect(chunk.content.length).toBeLessThanOrEqual(800);
    expect(chunk.metadata.summaryTruncated).toBe(true);
  });

  it('truncates symbolNames at limit', () => {
    const exports = Array.from({ length: 100 }, (_, i) => `export const sym${i} = ${i};`).join('\n');
    const facts = extractTsFacts('src/many.ts', exports);
    const chunk = buildCodeSummaryChunk('owner/repo', facts);

    expect(chunk.metadata.symbolNames!.length).toBeLessThanOrEqual(64);
    expect(chunk.metadata.symbolsTruncated).toBe(true);
  });

  it('normalizes and escapes file paths in chunk ids', () => {
    const facts = extractTsFacts('src/cafe\u0301:worker.ts', 'export function run() {}');
    const chunk = buildCodeSummaryChunk('owner/repo', facts);

    expect(chunk.id).toBe('owner/repo:code:src/café%3Aworker.ts');
    expect(chunk.metadata.filePath).toBe('src/cafe\u0301:worker.ts');
  });

  it('includes class method names in metadata symbolNames for code window lookup', () => {
    const facts = extractTsFacts('src/router.ts', `
export class Router {
  classify(query: string): string { return query; }
}
`);
    const chunk = buildCodeSummaryChunk('owner/repo', facts);

    expect(chunk.metadata.symbolNames).toContain('Router');
    expect(chunk.metadata.symbolNames).toContain('classify');
  });

  it('encodes githubUrl path segments safely', () => {
    const facts = extractTsFacts('src/space #file.ts', 'export function run() {}');
    const chunk = buildCodeSummaryChunk('owner/repo', facts, 'abc123');

    expect(chunk.metadata.githubUrl).toBe('https://github.com/owner/repo/blob/abc123/src/space%20%23file.ts');
  });
});

// ═══ chunkCodeSummaries ═════════════════════════════════════════

describe('chunkCodeSummaries', () => {
  it('processes multiple files and skips non-indexable ones', () => {
    const files = [
      { path: 'src/utils.ts', content: 'export function foo() {}', size: 100 },
      { path: 'docs/readme.md', content: '# Hello', size: 50 },
      { path: 'src/bar.test.ts', content: 'export function test() {}', size: 100 },
      { path: 'lib/rag/types.ts', content: 'export interface Chunk { id: string; }', size: 200 },
    ];

    const chunks = chunkCodeSummaries('owner/repo', files);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].metadata.filePath).toBe('src/utils.ts');
    expect(chunks[1].metadata.filePath).toBe('lib/rag/types.ts');
  });

  it('skips files with no exports', () => {
    const files = [
      { path: 'src/side-effect.ts', content: 'console.log("hello");', size: 50 },
    ];

    const chunks = chunkCodeSummaries('owner/repo', files);
    expect(chunks).toHaveLength(0);
  });

  it('skips files that fail to parse without throwing', () => {
    const files = [
      { path: 'src/good.ts', content: 'export function ok() {}', size: 50 },
      // Intentionally malformed — should be skipped gracefully
      { path: 'src/broken.ts', content: '{{{{invalid syntax', size: 50 },
    ];

    // Should not throw
    const chunks = chunkCodeSummaries('owner/repo', files);
    // broken.ts may or may not produce a chunk depending on TS parser tolerance
    // but it should NOT throw
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });
});
