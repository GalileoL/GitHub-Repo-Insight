# Requirements: Multi-Language AST Chunking

> Feature: replace regex fallback for Python / Go / Rust / Java / Kotlin with tree-sitter (WASM)
> Owner: RAG chunking pipeline
> Status: Ready for implementation
> Related research: [`../2026-05-14-rag-multi-language-ast-research.md`](../2026-05-14-rag-multi-language-ast-research.md)

---

## 1. Introduction

Today only TypeScript / JavaScript receives AST-grade extraction via the TypeScript Compiler API. Other languages use a regex fallback that misses nested declarations, modifiers, and language-specific export semantics, producing low-quality `symbolNames`. This feature introduces a tree-sitter WASM parser path that produces output equivalent in shape to the TS path for Python, Go, Rust, Java, and Kotlin.

## 2. User Stories

- **US-1** As a **user asking questions about a Python repo**, I want retrieval to surface the same depth of symbol metadata as a TypeScript repo, so that answer quality is language-parity.
- **US-2** As an **operator deploying to Vercel**, I want WASM grammars to not bloat my function bundle past the 50MB Vercel hard limit.
- **US-3** As a **developer adding a new language**, I want to plug it in by writing one `.scm` query file plus one entry in the language registry.
- **US-4** As an **operator**, I want WASM load failures to degrade gracefully to the regex fallback, so that ingest never hard-fails.

## 3. Functional Requirements (EARS)

- **REQ-1** WHEN a candidate file's language is one of `python | go | rust | java | kotlin`, THE SYSTEM SHALL parse it via tree-sitter and emit `symbolNames` using the unified format defined in §4.
- **REQ-2** WHEN a candidate file's language is `typescript | javascript`, THE SYSTEM SHALL continue to use the TypeScript Compiler API path (higher fidelity).
- **REQ-3** WHEN a tree-sitter grammar fails to load (network error fetching wasm, instantiate throw, query compile error), THE SYSTEM SHALL fall back to the existing regex extractor for that file and emit a `parser_fallback` eval event.
- **REQ-4** THE SYSTEM SHALL lazy-load each language grammar on first encounter; subsequent files of the same language SHALL reuse the cached instance.
- **REQ-5** THE SYSTEM SHALL NOT bundle `.wasm` files inside any serverless function output. WASM files SHALL be served from `public/wasm/` (or an external CDN configured via `WASM_BASE_URL`).
- **REQ-6** THE SYSTEM SHALL produce `symbolNames` strings in the exact format table below (REQ-1, REQ-2 both bound to it):

  | Symbol type   | Format                            | Example                       |
  |---------------|-----------------------------------|-------------------------------|
  | Top-level fn  | `name(arity)`                     | `parseRequest(2)`             |
  | Class         | `ClassName`                       | `RagClient`                   |
  | Class method  | `ClassName.method(arity)`         | `RagClient.embed(1)`          |
  | Interface     | `Name`                            | `ChunkMetadata`               |
  | Type alias    | `Name`                            | `Diff`                        |
  | Enum          | `EnumName`                        | `ChunkType`                   |
  | Enum member   | `EnumName.member`                 | `ChunkType.CodeSummary`       |

  Variadic / rest params are denoted with `+`, e.g. `log(2+)`.

- **REQ-7** THE language detection function SHALL infer language by file extension only: `.py → python`, `.go → go`, `.rs → rust`, `.java → java`, `.kt → kotlin`.
- **REQ-8** Each `.scm` query file SHALL be co-located with the parser code under `lib/rag/chunking/parsers/queries/`.
- **REQ-9** THE SYSTEM SHALL produce a stable order of `symbolNames` (source-order traversal); equal input MUST yield byte-identical metadata across runs.
- **REQ-10** THE SYSTEM SHALL emit a `parser_used` eval event per file containing `{repo, filePath, language, parser: 'ts-compiler' | 'tree-sitter' | 'regex-fallback', durationMs, symbolCount}`.

## 4. Non-Functional Requirements

- **NFR-1 Quality**: For a curated 20-file corpus per language (provided in `test/fixtures/multi-lang/`), tree-sitter SHALL match a hand-labeled gold set with ≥ 90% precision and ≥ 90% recall on `symbolNames`.
- **NFR-2 Performance**: Per-file parse time SHALL be ≤ 50 ms (excluding cold WASM load) for files ≤ 50 KB.
- **NFR-3 Bundle size**: The added JS bundle (excluding `.wasm` static assets) SHALL be ≤ 200 KB compressed.
- **NFR-4 Memory**: Idle module-level grammar cache for 5 loaded languages SHALL stay under 80 MB.
- **NFR-5 Single dependency**: Only `web-tree-sitter` may be added to `package.json`.
- **NFR-6 No regression**: TS/JS extraction output SHALL be byte-identical before and after this change.

## 5. Out of Scope

- Adding languages beyond the five listed (C/C++/Ruby/PHP/...): future iteration; just add an entry.
- Per-ingest WASM unload / `ParserContext` lifecycle (explicitly rejected, see research doc §7.4).
- LLM-driven symbol extraction or enrichment.
- Token-windowed sub-chunking of large declarations (separate "large file split" feature).

## 6. Acceptance Criteria

- **AC-1** Python: `def`, `async def`, `class`, decorated functions, methods inside classes all yield correct `symbolNames` in unified format. Nested `def`s inside other functions are excluded.
- **AC-2** Go: only `^[A-Z]` (exported) top-level `func`, `type`, `const`, `var` are emitted.
- **AC-3** Rust: `pub fn`, `pub struct`, `pub enum`, `pub trait` and their `pub(crate)` variants are emitted; non-`pub` items are excluded.
- **AC-4** Java: `public class`, `public interface`, `public enum`, and `public` methods. Modifier order (`public static final` vs `static public final`) does not matter.
- **AC-5** Kotlin: `fun`, `class`, `interface`, `object`, including `suspend fun` and `internal` modifiers.
- **AC-6** TS Compiler path output is byte-identical to baseline (snapshot test on existing fixtures).
- **AC-7** Forcing `WASM_BASE_URL` to an unreachable URL causes graceful fallback to regex with a `parser_fallback` eval event.
- **AC-8** Function bundle size after build (excluding `public/`) does not exceed previous size + 200 KB.
- **AC-9** Running ingest twice on the same Python repo, second run with grammar already cached, second-run parse time excludes the cold-load 50–100 ms.
