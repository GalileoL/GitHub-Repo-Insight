# Design: Multi-Language AST Chunking

> Implements: [`requirements.md`](./requirements.md)
> Research source: [`../2026-05-14-rag-multi-language-ast-research.md`](../2026-05-14-rag-multi-language-ast-research.md)

---

## 1. Architecture Overview

```
extractCodeFacts(filePath, content)
   │
   ├── detectLanguage(filePath) ──► lang
   ├── getParser(lang) ──► LanguageParser
   │       ├── lang ∈ {ts, js}     → TypeScriptParser (existing path)
   │       ├── lang ∈ {py,go,rs,java,kt} → TreeSitterParser
   │       └── unknown / load-fail → RegexFallbackParser (existing)
   ├── parser.extract(filePath, content) ──► ExtractedCodeFacts
   └── normalizeSymbols(facts) ──► unified symbolNames
```

Existing-code touchpoints:
- `lib/rag/chunking/code-summary.ts` — extraction entry routed through new registry.
- `lib/rag/chunking/parsers/` — new directory housing all parser implementations.
- `lib/rag/types.ts` — no schema changes (output shape unchanged).

## 2. Module Layout

```
lib/rag/chunking/parsers/
  index.ts                    ← registry + getParser()
  language.ts                 ← detectLanguage()
  format.ts                   ← formatSymbol() — shared by ALL parsers
  typescript.ts               ← wraps existing ts compiler logic
  treesitter.ts               ← generic tree-sitter parser
  regex-fallback.ts           ← wraps existing regex logic
  grammar-loader.ts           ← lazy WASM loading + module cache
  queries/
    python.scm
    go.scm
    rust.scm
    java.scm
    kotlin.scm
public/wasm/
  tree-sitter-python.wasm
  tree-sitter-go.wasm
  tree-sitter-rust.wasm
  tree-sitter-java.wasm
  tree-sitter-kotlin.wasm
```

## 3. Language Detection

```ts
export type Lang = 'ts' | 'js' | 'py' | 'go' | 'rs' | 'java' | 'kt';

const EXT_TO_LANG: Record<string, Lang> = {
  ts: 'ts', tsx: 'ts', js: 'js', jsx: 'js',
  py: 'py', go: 'go', rs: 'rs', java: 'java', kt: 'kt',
};

export function detectLanguage(filePath: string): Lang | null {
  const ext = filePath.toLowerCase().split('.').pop();
  return ext ? EXT_TO_LANG[ext] ?? null : null;
}
```

## 4. Grammar Loader (`grammar-loader.ts`)

```ts
import { Language, Parser } from 'web-tree-sitter';

const grammarCache = new Map<Lang, Promise<Language>>();
const TS_LANGS: Lang[] = ['py', 'go', 'rs', 'java', 'kt'];

async function initParser(): Promise<void> {
  await Parser.init({
    locateFile: (file: string) =>
      `${process.env.WASM_BASE_URL ?? '/wasm'}/${file}`,
  });
}

let parserInitPromise: Promise<void> | null = null;
function getInit() {
  if (!parserInitPromise) parserInitPromise = initParser();
  return parserInitPromise;
}

export async function getGrammar(lang: Lang): Promise<Language> {
  if (!TS_LANGS.includes(lang)) throw new Error(`unsupported tree-sitter lang: ${lang}`);
  if (!grammarCache.has(lang)) {
    grammarCache.set(lang, (async () => {
      await getInit();
      const url = `${process.env.WASM_BASE_URL ?? '/wasm'}/tree-sitter-${lang}.wasm`;
      const bytes = await fetch(url).then((r) => {
        if (!r.ok) throw new Error(`wasm fetch ${r.status} for ${lang}`);
        return r.arrayBuffer();
      });
      return Language.load(new Uint8Array(bytes));
    })());
  }
  return grammarCache.get(lang)!;
}
```

Key properties:
- Module-level cache → one fetch + instantiate per function instance per language (REQ-4).
- WASM URL configurable via `WASM_BASE_URL`; defaults to `/wasm` for `public/`-served deployments (REQ-5).
- A load failure rejects the Promise; the registry catches and falls back to regex (REQ-3).

## 5. TreeSitterParser (`treesitter.ts`)

```ts
import Parser from 'web-tree-sitter';
import { getGrammar } from './grammar-loader.js';
import { loadQuery } from './queries/index.js';
import { formatSymbol } from './format.js';

export async function extractWithTreeSitter(
  filePath: string,
  content: string,
  lang: Lang,
): Promise<ExtractedCodeFacts> {
  const language = await getGrammar(lang);
  const parser   = new Parser();
  parser.setLanguage(language);
  const tree     = parser.parse(content);

  const query = await loadQuery(lang, language);  // compiles .scm once, cached
  const matches = query.matches(tree.rootNode);

  const symbols: SymbolDescriptor[] = [];
  for (const m of matches) {
    for (const cap of m.captures) {
      symbols.push(captureToSymbol(cap, content));
    }
  }

  return {
    filePath,
    language: lang,
    symbolNames: symbols.map(formatSymbol),
    // …other fields aligned with existing ExtractedCodeFacts shape
  };
}
```

Notes:
- `Parser` instance is per-call (cheap once grammar is loaded). The expensive resource is `Language`, which is cached.
- `loadQuery` reads `.scm` text (bundled as a string import) and compiles via `language.query(text)`; the compiled `Query` object is module-cached per lang.

## 6. Unified Symbol Formatter (`format.ts`)

```ts
export type SymbolDescriptor =
  | { kind: 'function'; name: string; arity: number; variadic: boolean }
  | { kind: 'class'; name: string }
  | { kind: 'method'; className: string; name: string; arity: number; variadic: boolean }
  | { kind: 'interface' | 'type' | 'enum'; name: string }
  | { kind: 'enum-member'; enumName: string; name: string };

export function formatSymbol(s: SymbolDescriptor): string {
  switch (s.kind) {
    case 'function':    return `${s.name}(${s.arity}${s.variadic ? '+' : ''})`;
    case 'method':      return `${s.className}.${s.name}(${s.arity}${s.variadic ? '+' : ''})`;
    case 'enum-member': return `${s.enumName}.${s.name}`;
    default:            return s.name;
  }
}
```

**Critical**: TypeScriptParser must construct the same `SymbolDescriptor` shape and pass through `formatSymbol`. A shared single-source-of-truth eliminates the dual-format risk flagged in research §7.3.

## 7. Query Files (`queries/*.scm`)

Each file declares the capture names that `captureToSymbol()` translates into `SymbolDescriptor`. Initial concrete drafts (subject to test-driven refinement):

**`queries/python.scm`**:
```scheme
(module (function_definition name: (identifier) @function))
(module (decorated_definition (function_definition name: (identifier) @function)))
(module (class_definition name: (identifier) @class))
(class_definition
  body: (block (function_definition name: (identifier) @method)))
```

**`queries/go.scm`**:
```scheme
(source_file (function_declaration name: (identifier) @function
  (#match? @function "^[A-Z]")))
(source_file (type_declaration (type_spec
  name: (type_identifier) @type
  (#match? @type "^[A-Z]"))))
```

**`queries/rust.scm`**:
```scheme
(source_file (function_item (visibility_modifier) name: (identifier) @function))
(source_file (struct_item (visibility_modifier) name: (type_identifier) @struct))
(source_file (enum_item    (visibility_modifier) name: (type_identifier) @enum))
(source_file (trait_item   (visibility_modifier) name: (type_identifier) @trait))
```

**`queries/java.scm`**:
```scheme
(class_declaration
  (modifiers) @mods (#match? @mods "public")
  name: (identifier) @class)
(method_declaration
  (modifiers) @mods (#match? @mods "public")
  name: (identifier) @method)
```

**`queries/kotlin.scm`**:
```scheme
(source_file (function_declaration (simple_identifier) @function))
(source_file (class_declaration   (type_identifier)   @class))
(source_file (object_declaration  (type_identifier)   @object))
```

Final query forms will iterate against the test fixtures during T-phase. The Aider project's `.scm` files (Apache-2) serve as a reference; any direct copy will retain attribution in the file header.

## 8. Registry (`index.ts`)

```ts
export interface LanguageParser {
  language: Lang;
  extract(filePath: string, content: string): Promise<ExtractedCodeFacts>;
}

export async function getParser(filePath: string): Promise<LanguageParser> {
  const lang = detectLanguage(filePath);
  if (!lang) return regexFallbackParser;
  if (lang === 'ts' || lang === 'js') return typescriptParser;
  try {
    await getGrammar(lang);  // warm cache; reveals load errors early
    return makeTreeSitterParser(lang);
  } catch (err) {
    emitEvalEvent('parser_fallback', { lang, reason: String(err) });
    return regexFallbackParser;
  }
}
```

## 9. WASM Deployment

- Build step: copy `node_modules/tree-sitter-{lang}/tree-sitter-{lang}.wasm` to `public/wasm/`.
- `public/` is served by Vercel CDN; no inclusion in function bundle (REQ-5, NFR-3).
- Optional escape hatch: set `WASM_BASE_URL=https://cdn.example.com/wasm` to point elsewhere.
- Local dev: same `public/` path; Vite already serves it.

`scripts/copy-wasm.mjs` runs in `postinstall` and `prebuild`.

## 10. Error Handling Matrix

| Failure                                 | Behavior                                   |
|------------------------------------------|--------------------------------------------|
| `Parser.init` throws (incompat runtime) | regex fallback for all non-TS files; eval event |
| `fetch wasm` 404 / network              | per-lang fallback to regex; eval event     |
| `Language.load` throws                  | per-lang fallback; eval event              |
| `language.query(scm)` compile error     | per-lang fallback; raise in test ASAP      |
| `tree.parse` returns on malformed input | tree-sitter is error-tolerant; symbols may be partial — accepted |
| Per-file parse exceeds 5 s              | timeout, fallback to regex for that file   |

## 11. Test Strategy

- **Gold fixtures** under `test/fixtures/multi-lang/{python,go,rust,java,kotlin}/`:
  - 20 hand-labeled files per language (mix of idiomatic patterns).
  - Each fixture paired with `*.expected.json` listing expected `symbolNames`.
- **Unit tests**:
  - `format.test.ts`: every `SymbolDescriptor` kind produces the documented string.
  - `language.test.ts`: extension → Lang mapping including unknown.
  - `treesitter.test.ts` per language: load grammar, parse fixture, compare to gold; precision/recall computed and asserted ≥ 0.9 (NFR-1).
- **Snapshot regression**:
  - `typescript.test.ts`: identical output to pre-change baseline on existing fixtures (NFR-6).
- **Failure path**:
  - Mock fetch to 500 → eval `parser_fallback` emitted and regex output used.
- **Build size**:
  - CI check compares `.vercel/output/functions/**/index.js` size delta against main branch + 200 KB (NFR-3).
- **Smoke**:
  - Ingest a small Python repo, observe `parser_used` events report `parser: 'tree-sitter'` and `symbolCount > 0`.

## 12. Rollout

1. Land code with `MULTI_LANG_AST_ENABLED=0` default → existing regex path remains live.
2. Flip `MULTI_LANG_AST_ENABLED=1` in staging; run smoke fixtures; verify `parser_used` events.
3. Production rollout language-by-language via allowlist env `MULTI_LANG_AST_LANGS='py,go'` (starts narrow, widens as confidence grows).
4. Rollback: unset env → fully reverts to regex path with no code revert.

## 13. Open Decisions Resolved

- Single shared `symbolNames` format across all parsers — yes, enforced by `formatSymbol()`.
- WASM bundling — never bundle in function; always `public/` or CDN.
- WASM cache lifecycle — module-level, reuse across calls within a function instance; no per-ingest teardown.
- Regex fallback — retained permanently as load-failure path.

---

## 14. Review Comments & Suggestions (Gemini CLI, round 2)

> Status: ✅ applied / 📌 deferred / ❌ rejected.

### 14.1 内存与并发控制 ❌ rejected
- **建议**：在 `getGrammar` 中加入互斥锁，防止并发调用重复 fetch 同一 WASM。
- **驳回理由**：design §4 的 `grammarCache.set(lang, Promise)` **存的是 in-flight Promise，不是 resolved value**。任何并发对同一 `lang` 的 `getGrammar` 调用都会拿到同一个 Promise（map 命中即返回），fetch + instantiate 天然只发生一次。互斥锁是冗余设计，徒增复杂度。
- **保留事实**：高并发 Ingest 下，若同时遇到 5 种语言，5 次 fetch 会并发进行 —— 这是期望行为，单语言的去重已由 Promise cache 保证。

### 14.2 符号归一化的边界 ✅ applied — see §6.1 below

---

## 6.1 Symbol Normalization Rules (added per Gemini round-2 §14.2)

`captureToSymbol()` MUST strip language-specific syntactic noise before building `SymbolDescriptor`:

| Language | Noise to strip                                              | Example                                  |
|----------|-------------------------------------------------------------|------------------------------------------|
| Python   | Decorators (`@dataclass`, `@app.route(...)`, `@staticmethod`) | `@app.route("/x")\ndef handler():` → `handler` |
| Python   | Async keyword (kept as a non-name flag, not in name)        | `async def fetch()` → `fetch`, with `isAsync: true` if ever needed |
| Rust     | Attributes (`#[derive(...)]`, `#[inline]`)                  | `#[derive(Debug)] pub struct Foo` → `Foo` |
| Rust     | Visibility modifiers (`pub`, `pub(crate)`)                  | filter-only, never part of the name      |
| Java     | Annotations (`@Override`, `@Inject`)                        | `@Override public void run()` → `run`    |
| Java     | Modifier soup (`public static final synchronized`)          | filter-only                              |
| Kotlin   | Annotations (`@JvmStatic`), modifiers (`suspend`, `internal`)| `suspend fun fetch()` → `fetch`          |
| Go       | (no decorators; just name)                                  | —                                        |

The captured `@symbol.*` node in the `.scm` query MUST point to the identifier node only — never to the wrapping `decorated_definition` / `attribute_item` — so that `node.text` is already noise-free. Unit tests in `format.test.ts` MUST assert that decorated/annotated declarations produce identical symbol names to their bare counterparts.
