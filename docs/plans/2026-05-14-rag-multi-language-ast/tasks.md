# Implementation Tasks: Multi-Language AST Chunking

> Implements: [`design.md`](./design.md) for [`requirements.md`](./requirements.md)

---

## Phase 0 — Spike & dependency

- [ ] **T0.1** Add `web-tree-sitter` to `dependencies`; verify it loads under Vercel Node runtime (local `vc dev` smoke).
  - Satisfies: NFR-5
- [ ] **T0.2** Identify the source npm packages for each `.wasm`: `tree-sitter-python`, `tree-sitter-go`, `tree-sitter-rust`, `tree-sitter-java`, `tree-sitter-kotlin`. Add as `devDependencies` (only `.wasm` files used at runtime).
- [ ] **T0.3** Add `scripts/copy-wasm.mjs` to copy `.wasm` files into `public/wasm/` during `postinstall` and `prebuild`.
  - Satisfies: REQ-5, NFR-3
  - Done when: `ls public/wasm/` shows 5 files after fresh install.

## Phase 1 — Fixtures & gold sets

- [ ] **T1.1** Create `test/fixtures/multi-lang/python/` with 20 representative files and `*.expected.json`.
  - Satisfies: AC-1, NFR-1
- [ ] **T1.2** Same for `go`.
  - Satisfies: AC-2
- [ ] **T1.3** Same for `rust`.
  - Satisfies: AC-3
- [ ] **T1.4** Same for `java`.
  - Satisfies: AC-4
- [ ] **T1.5** Same for `kotlin`.
  - Satisfies: AC-5

## Phase 2 — Shared infrastructure

- [ ] **T2.1** Create `lib/rag/chunking/parsers/language.ts` with `detectLanguage()`.
  - Satisfies: REQ-7
- [ ] **T2.2** Create `lib/rag/chunking/parsers/format.ts` with `SymbolDescriptor` and `formatSymbol()`.
  - Satisfies: REQ-6
  - Done when: `format.test.ts` covers every kind incl. variadic.
- [ ] **T2.3** Create `lib/rag/chunking/parsers/grammar-loader.ts` with module-level cache + `Parser.init` once.
  - Satisfies: REQ-4, REQ-5
  - Done when: unit test asserts second call to `getGrammar('py')` returns same Promise.

## Phase 3 — Parser implementations

- [ ] **T3.1** Implement `typescript.ts` wrapping existing TS Compiler logic into the `LanguageParser` interface, routing output through `formatSymbol`.
  - Satisfies: REQ-2, REQ-6, NFR-6
- [ ] **T3.2** Implement `regex-fallback.ts` wrapping existing regex extractors.
  - Satisfies: REQ-3
- [ ] **T3.3** Implement `treesitter.ts` generic parser using `getGrammar` + `loadQuery`.
  - Satisfies: REQ-1, REQ-9

## Phase 4 — Query files (per language)

- [ ] **T4.1** Author `queries/python.scm` and iterate against `test/fixtures/multi-lang/python` until ≥ 0.9 P/R.
  - Satisfies: AC-1
- [ ] **T4.2** `queries/go.scm` to ≥ 0.9 P/R.
  - Satisfies: AC-2
- [ ] **T4.3** `queries/rust.scm` to ≥ 0.9 P/R.
  - Satisfies: AC-3
- [ ] **T4.4** `queries/java.scm` to ≥ 0.9 P/R.
  - Satisfies: AC-4
- [ ] **T4.5** `queries/kotlin.scm` to ≥ 0.9 P/R.
  - Satisfies: AC-5

## Phase 5 — Registry & integration

- [ ] **T5.1** Implement `parsers/index.ts` with `getParser()`, including grammar warm-up + try/catch fallback emission.
  - Satisfies: REQ-3, REQ-10
- [ ] **T5.2** Update `lib/rag/chunking/code-summary.ts` to call `getParser(filePath).extract(...)` instead of directly invoking TS / regex logic.
  - Satisfies: REQ-1, REQ-2
- [ ] **T5.3** Emit `parser_used` eval event per file.
  - Satisfies: REQ-10
- [ ] **T5.4** Implement `MULTI_LANG_AST_ENABLED` and `MULTI_LANG_AST_LANGS` env gating in the registry; default `disabled`.
  - Satisfies: rollout plan, REQ-3

## Phase 6 — Validation tests

- [ ] **T6.1** TS snapshot regression test: confirm zero output drift on existing fixtures.
  - Satisfies: NFR-6, AC-6
- [ ] **T6.2** Per-language precision/recall test asserting ≥ 0.9 against gold sets.
  - Satisfies: NFR-1
- [ ] **T6.3** Grammar-load failure test (mock fetch 500 → expect fallback + `parser_fallback` event).
  - Satisfies: REQ-3, AC-7
- [ ] **T6.4** Bundle-size check in CI: function output size delta < 200 KB vs main.
  - Satisfies: NFR-3, AC-8
- [ ] **T6.5** Cold/warm parse-time benchmark: first python parse includes ~50–100 ms cold load; second is < 50 ms.
  - Satisfies: NFR-2, AC-9

## Phase 7 — Rollout & Docs

- [ ] **T7.1** README & TROUBLESHOOTING: how to set `WASM_BASE_URL`, how to flip `MULTI_LANG_AST_LANGS`.
- [ ] **T7.2** Document attribution for any Aider-derived `.scm` content (Apache-2 NOTICE in repo).
- [ ] **T7.3** Staging deploy with `MULTI_LANG_AST_LANGS='py'`; observe `parser_used` events for 24h.
- [ ] **T7.4** Gradually expand to `'py,go'`, `'py,go,rs'`, etc., one language per release.

---

## Dependency Graph

```
Phase 0 ─► Phase 1 (per-lang fixtures, parallel) ─┐
Phase 0 ─► Phase 2 (shared infra) ────────────────┤
                                                  ├─► Phase 3 ─► Phase 4 (per-lang, parallel) ─► Phase 5 ─► Phase 6 ─► Phase 7
```

Phase 4 sub-tasks (T4.1–T4.5) are independent and may be parallelized across reviewers / contributors.
