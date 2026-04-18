import ts from 'typescript';
import type { Chunk, ChunkMetadata, ExtractedCodeFacts } from '../types.js';

// ═══ Constants ══════════════════════════════════════════════════

const SUMMARY_HARD_LIMIT = 800;
const SYMBOL_NAMES_LIMIT = 64;
const SYMBOL_NAME_MAX_LENGTH = 80;
const INTERNAL_HELPERS_LIMIT = 10;

/** Directories to include for code summary indexing */
const INCLUDE_DIRS = ['src/', 'lib/', 'api/'];

/** Patterns to exclude from code summary indexing */
const EXCLUDE_PATTERNS = [
  /\.test\./,
  /\.spec\./,
  /\/dist\//,
  /\/build\//,
  /\/coverage\//,
  /\/node_modules\//,
  /\.min\./,
  /\.d\.ts$/,
  /\/vendor\//,
  /\/__fixtures__\//,
  /\/__mocks__\//,
];

/** Max file size in bytes to consider for indexing */
const MAX_FILE_SIZE = 100_000; // 100KB

// ═══ File Filtering ═════════════════════════════════════════════

/** Check if a file path should be included for code summary indexing */
export function shouldIndexFile(filePath: string, fileSize?: number): boolean {
  if (fileSize !== undefined && fileSize > MAX_FILE_SIZE) return false;

  const normalizedPath = filePath.replace(/\\/g, '/');

  const inAllowedDir = INCLUDE_DIRS.some((dir) => normalizedPath.startsWith(dir));
  if (!inAllowedDir) return false;

  if (EXCLUDE_PATTERNS.some((pattern) => pattern.test(normalizedPath))) return false;

  // Only index known source file extensions
  const ext = normalizedPath.split('.').pop()?.toLowerCase();
  const allowedExts = new Set(['ts', 'tsx', 'js', 'jsx', 'py', 'go', 'rs', 'java', 'kt']);
  if (!ext || !allowedExts.has(ext)) return false;

  return true;
}

// ═══ AST Extraction (TypeScript/JavaScript) ═════════════════════

function hasExportModifier(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  const mods = ts.getModifiers(node);
  return mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

function getNodeName(node: ts.Node): string | null {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node)
  ) {
    return node.name?.text ?? null;
  }
  if (ts.isVariableStatement(node)) {
    const decl = node.declarationList.declarations[0];
    if (decl && ts.isIdentifier(decl.name)) return decl.name.text;
  }
  return null;
}

function getFunctionSignature(node: ts.FunctionDeclaration, sourceFile: ts.SourceFile): string {
  const name = node.name?.text ?? 'default';
  const params = node.parameters
    .map((p) => p.getText(sourceFile))
    .join(', ');
  const returnType = node.type ? `: ${node.type.getText(sourceFile)}` : '';
  return `${name}(${params})${returnType}`;
}

function getClassSignature(node: ts.ClassDeclaration, sourceFile: ts.SourceFile): string {
  const name = node.name?.text ?? 'default';
  const members = node.members
    .filter((m): m is ts.MethodDeclaration => ts.isMethodDeclaration(m))
    .filter((m) => {
      if (!ts.canHaveModifiers(m)) return true;
      const mods = ts.getModifiers(m);
      return !mods?.some((mod) => mod.kind === ts.SyntaxKind.PrivateKeyword);
    })
    .slice(0, 5)
    .map((m) => {
      const methodName = m.name?.getText(sourceFile) ?? '';
      const params = m.parameters.map((p) => p.getText(sourceFile)).join(', ');
      return `${methodName}(${params})`;
    });
  const methodsSummary = members.length > 0 ? ` { ${members.join('; ')} }` : '';
  return `class ${name}${methodsSummary}`;
}

function getLeadingJSDoc(sourceFile: ts.SourceFile): string | null {
  const text = sourceFile.getFullText();
  const match = /^\/\*\*\s*([\s\S]*?)\s*\*\//.exec(text);
  if (!match) return null;
  return match[1]
    .split('\n')
    .map((line) => line.replace(/^\s*\*\s?/, '').trim())
    .filter(Boolean)
    .join(' ')
    .slice(0, 200);
}

/** Extract structured facts from a TypeScript/JavaScript source file */
export function extractTsFacts(filePath: string, content: string): ExtractedCodeFacts {
  const isTypeScript = /\.tsx?$/.test(filePath);
  const language = isTypeScript ? 'typescript' : 'javascript';

  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    /\.tsx$/.test(filePath) ? ts.ScriptKind.TSX : /\.jsx$/.test(filePath) ? ts.ScriptKind.JSX : undefined,
  );

  const exports: string[] = [];
  const symbolSignatures: string[] = [];
  const internalHelpers: string[] = [];
  const importPaths: string[] = [];
  const kindHints: string[] = [];

  for (const stmt of sourceFile.statements) {
    // Imports
    if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
      importPaths.push(stmt.moduleSpecifier.text);
      continue;
    }

    // Export declarations (re-exports)
    if (ts.isExportDeclaration(stmt)) {
      if (stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)) {
        importPaths.push(stmt.moduleSpecifier.text);
      }
      if (stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
        for (const el of stmt.exportClause.elements) {
          exports.push(el.name.text);
        }
      }
      continue;
    }

    // Export assignment (export default)
    if (ts.isExportAssignment(stmt)) {
      const expr = stmt.expression;
      if (ts.isIdentifier(expr)) {
        exports.push(expr.text);
      } else {
        exports.push('default');
      }
      continue;
    }

    const isExported = hasExportModifier(stmt);
    const name = getNodeName(stmt);

    if (ts.isFunctionDeclaration(stmt)) {
      const sig = getFunctionSignature(stmt, sourceFile);
      if (isExported) {
        if (name) exports.push(name);
        symbolSignatures.push(sig);
      } else if (name && internalHelpers.length < INTERNAL_HELPERS_LIMIT) {
        internalHelpers.push(name);
      }
      continue;
    }

    if (ts.isClassDeclaration(stmt)) {
      const sig = getClassSignature(stmt, sourceFile);
      if (isExported) {
        if (name) exports.push(name);
        symbolSignatures.push(sig);
      } else if (name && internalHelpers.length < INTERNAL_HELPERS_LIMIT) {
        internalHelpers.push(name);
      }
      continue;
    }

    if (ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt) || ts.isEnumDeclaration(stmt)) {
      if (isExported && name) {
        exports.push(name);
        symbolSignatures.push(name);
      }
      continue;
    }

    if (ts.isVariableStatement(stmt)) {
      if (isExported && name) {
        exports.push(name);
        symbolSignatures.push(name);
      } else if (name && internalHelpers.length < INTERNAL_HELPERS_LIMIT) {
        internalHelpers.push(name);
      }
      continue;
    }
  }

  const jsDocSummary = getLeadingJSDoc(sourceFile);

  // Kind hints
  if (/^api\//.test(filePath) && (exports.includes('handler') || exports.includes('default'))) {
    kindHints.push('route-handler');
  }
  if (exports.some((e) => /^use[A-Z]/.test(e))) {
    kindHints.push('react-hook');
  }
  if (exports.some((e) => /^[A-Z]/.test(e) && !e.includes('_'))) {
    // Heuristic: PascalCase exports in src/ with JSX are likely components
    if (/\.tsx$/.test(filePath) || /\.jsx$/.test(filePath)) {
      kindHints.push('react-component');
    }
  }
  if (exports.every((e) => /^[A-Z]/.test(e)) && symbolSignatures.length > 0 &&
      symbolSignatures.every((s) => !s.includes('('))) {
    kindHints.push('type-definition');
  }

  // Role hint from path
  const pathSegments = filePath.split('/');
  const roleKeywords = ['retrieval', 'llm', 'storage', 'auth', 'chunking', 'metrics', 'github', 'intents'];
  const roleHint = pathSegments.find((seg) => roleKeywords.includes(seg)) ?? null;

  return {
    filePath,
    language,
    roleHint,
    exports,
    symbolSignatures,
    internalHelpers,
    importPaths,
    kindHints,
    jsDocSummary,
  };
}

// ═══ Regex Fallback (non-TS/JS) ═════════════════════════════════

const REGEX_RULES: Record<string, RegExp[]> = {
  py: [/^(?:def|class|async def)\s+(\w+)/gm],
  go: [/^func\s+(\w+)/gm, /^type\s+(\w+)\s+(?:struct|interface)/gm],
  rs: [/^pub\s+(?:fn|struct|enum|trait)\s+(\w+)/gm],
  java: [/^public\s+(?:class|interface|enum)\s+(\w+)/gm],
  kt: [/^(?:class|interface|object|fun)\s+(\w+)/gm],
};

/** Extract basic facts from non-TS/JS files using regex */
export function extractRegexFacts(filePath: string, content: string): ExtractedCodeFacts {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const rules = REGEX_RULES[ext] ?? [];

  const symbols: string[] = [];
  for (const rule of rules) {
    // Reset lastIndex for global regex
    rule.lastIndex = 0;
    let match;
    while ((match = rule.exec(content)) !== null) {
      if (match[1]) symbols.push(match[1]);
    }
  }

  // Extract first docstring-like comment
  let jsDocSummary: string | null = null;
  if (ext === 'py') {
    const docMatch = /^"""([\s\S]*?)"""/m.exec(content);
    if (docMatch) jsDocSummary = docMatch[1].trim().slice(0, 200);
  }

  return {
    filePath,
    language: ext,
    roleHint: null,
    exports: symbols,
    symbolSignatures: symbols,
    internalHelpers: [],
    importPaths: [],
    kindHints: [],
    jsDocSummary,
  };
}

// ═══ Unified Extraction Entry Point ═════════════════════════════

/** Extract code facts from a source file, choosing strategy by extension */
export function extractCodeFacts(filePath: string, content: string): ExtractedCodeFacts {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  if (['ts', 'tsx', 'js', 'jsx'].includes(ext)) {
    return extractTsFacts(filePath, content);
  }
  return extractRegexFacts(filePath, content);
}

// ═══ Summary Rendering ══════════════════════════════════════════

/** Render extracted facts into a semi-structured text summary */
export function renderCodeSummary(facts: ExtractedCodeFacts): string {
  const lines: string[] = [];

  lines.push(`File: ${facts.filePath}`);
  if (facts.roleHint || facts.jsDocSummary) {
    lines.push(`Role: ${facts.jsDocSummary ?? facts.roleHint ?? ''}`);
  }
  if (facts.exports.length > 0) {
    lines.push(`Exports: ${facts.exports.join(', ')}`);
  }
  if (facts.symbolSignatures.length > 0) {
    lines.push(`Symbols: ${facts.symbolSignatures.join('; ')}`);
  }
  if (facts.importPaths.length > 0) {
    lines.push(`Imports: ${facts.importPaths.join(', ')}`);
  }
  if (facts.kindHints.length > 0) {
    lines.push(`Hints: ${facts.kindHints.join(', ')}`);
  }
  if (facts.internalHelpers.length > 0) {
    lines.push(`Helpers: ${facts.internalHelpers.join(', ')}`);
  }

  return lines.join('\n');
}

// ═══ Chunk Building ═════════════════════════════════════════════

/** Build symbol names list for metadata, with truncation */
function buildSymbolNames(facts: ExtractedCodeFacts): { symbolNames: string[]; symbolsTruncated: boolean } {
  const signatureSymbols = facts.symbolSignatures.flatMap((signature) => {
    const names: string[] = [];
    const classMatch = /^class\s+([A-Za-z_]\w*)/.exec(signature);
    if (classMatch) {
      names.push(classMatch[1]);
    }
    for (const match of signature.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) {
      names.push(match[1]);
    }
    return names;
  });

  const allSymbols = [
    ...facts.exports,
    ...signatureSymbols,
    ...facts.internalHelpers,
  ];

  // Dedupe
  const unique = [...new Set(allSymbols)]
    .map((s) => s.slice(0, SYMBOL_NAME_MAX_LENGTH));

  if (unique.length <= SYMBOL_NAMES_LIMIT) {
    return { symbolNames: unique, symbolsTruncated: false };
  }

  return {
    symbolNames: unique.slice(0, SYMBOL_NAMES_LIMIT),
    symbolsTruncated: true,
  };
}

// Chunk IDs treat filePath as case-sensitive (matches Linux/Git semantics).
// Repos with case-insensitive FS collisions (e.g. Foo.ts vs foo.ts on macOS) are
// out of scope; NFC + `:` escape is sufficient for the indexed repo set.
function normalizeChunkPath(filePath: string): string {
  return filePath.normalize('NFC').replaceAll(':', '%3A');
}

function buildGithubBlobUrl(repo: string, filePath: string, commitSha?: string): string {
  const encodedPath = filePath
    .normalize('NFC')
    .split('/')
    .map(encodeURIComponent)
    .join('/');
  return `https://github.com/${repo}/blob/${commitSha ?? 'HEAD'}/${encodedPath}`;
}

/** Build a code summary chunk from extracted facts */
export function buildCodeSummaryChunk(
  repo: string,
  facts: ExtractedCodeFacts,
  commitSha?: string,
): Chunk {
  let summaryText = renderCodeSummary(facts);
  let summaryTruncated = false;

  if (summaryText.length > SUMMARY_HARD_LIMIT) {
    summaryText = summaryText.slice(0, SUMMARY_HARD_LIMIT);
    summaryTruncated = true;
  }

  const { symbolNames, symbolsTruncated } = buildSymbolNames(facts);

  const metadata: ChunkMetadata = {
    repo,
    type: 'code_summary',
    title: `Code: ${facts.filePath}`,
    githubUrl: buildGithubBlobUrl(repo, facts.filePath, commitSha),
    filePath: facts.filePath,
    language: facts.language,
    symbolNames,
    symbolsTruncated,
    summaryTruncated,
    lastIndexedSha: commitSha,
  };

  return {
    id: `${repo}:code:${normalizeChunkPath(facts.filePath)}`,
    content: summaryText,
    metadata,
  };
}

// ═══ Batch Processing ═══════════════════════════════════════════

export interface SourceFile {
  path: string;
  content: string;
  size?: number;
}

/** Generate code summary chunks from a list of source files */
export function chunkCodeSummaries(
  repo: string,
  files: SourceFile[],
  commitSha?: string,
): Chunk[] {
  const chunks: Chunk[] = [];

  for (const file of files) {
    if (!shouldIndexFile(file.path, file.size)) continue;

    try {
      const facts = extractCodeFacts(file.path, file.content);
      // Skip files with no meaningful exports or symbols
      if (facts.exports.length === 0 && facts.symbolSignatures.length === 0) continue;

      chunks.push(buildCodeSummaryChunk(repo, facts, commitSha));
    } catch (err) {
      console.warn(JSON.stringify({
        type: 'code_summary_parse_failed',
        repo,
        filePath: file.path,
        reason: err instanceof Error ? err.message : 'unknown',
      }));
      continue;
    }
  }

  return chunks;
}
