# 多语言代码 AST 切分调研

> 日期：2026-05-14
> 分支：`feature/rag-indexing-optimization-spec`
> 目的：评估如何把 Python / Go / Rust / Java / Kotlin 等语言的源码切分从「正则兜底」升级到与 TS/JS 同级别的 AST 精度。

---

## 1. 当前现状（基线）

- TS/JS：`lib/rag/chunking/code-summary.ts` 使用 `typescript` 包的 Compiler API，逐 `SourceFile` 遍历 AST，提取 `ExportDeclaration` / `FunctionDeclaration` / `ClassDeclaration` / `InterfaceDeclaration` / `TypeAliasDeclaration` / `EnumDeclaration`。
- 其他语言：仅用正则匹配 `def`、`func`、`fn`、`public class` 等关键字 → 漏判（嵌套、装饰器、修饰符顺序）、误判（注释/字符串中的关键字）、无层级信息。

问题：检索质量在多语言仓库上明显劣于 TS 仓库；symbolNames 容易丢函数签名。

---

## 2. 候选方案

### 2.1 Tree-sitter（推荐）

**机制**：增量解析器生成器；每种语言一个独立 grammar，输出统一的 CST/AST，可用 query DSL（S-expression）做模式匹配。

**在 Node.js 上的形态**：
- **Native bindings**：`tree-sitter` + `tree-sitter-python` 等，每种语言一个 native addon。需要 build 工具链。
- **WASM**：`web-tree-sitter` + 各语言预编译 `.wasm`。零原生依赖，跑在任何 Node/Edge runtime；性能比 native 慢 ≈ 2-3×，对索引侧的批处理仍然完全够用。
- **打包好的语言包**：`@vscode/tree-sitter-wasm`、`tree-sitter-wasms`（社区维护，含 30+ 预编译 wasm），可避免自己编译。

**为什么选它**：
- 一套 API 支持所有目标语言（Python/Go/Rust/Java/Kotlin/C/C++/Ruby/PHP …）。
- 编辑器级成熟度（GitHub、Neovim、Zed、Helix 都在用）。
- 容错解析（语法错误不会让整文件 fail）。
- 增量解析（与本仓 incremental indexing spec 天然契合）。
- Query DSL 直接命中「导出符号」类节点，无需手写 visitor。

**Vercel/Edge 兼容性**：WASM 路线本质是 `WebAssembly.instantiate`，已验证在 Vercel Node Functions 工作；冷启动加载 wasm ≈ 50-100ms 一次。索引侧 ingest 流程对冷启动延迟不敏感。

### 2.2 ast-grep（备选）

**机制**：Rust 写的多语言结构化搜索/替换工具，底层也是 tree-sitter。CLI 友好，也有 Node binding（`@ast-grep/napi`）。

**优点**：模式语法（YAML/MATCH）非常贴近「我要导出函数」这类需求，可读性高。
**缺点**：
- Node binding 是 native addon，Vercel deploy 需要 prebuilt 二进制（platform 矩阵）。
- 抽象比 tree-sitter 更高一层，不易控制遍历策略；对「枚举所有导出 + 计数」这类聚合不如直接遍历 AST 自由。

**结论**：作为后续 query 维护的 DX 改善选项保留，不作为底层方案。

### 2.3 各语言自带 parser

- Python：`@boltz/python` / 自写 indent-aware parser → 维护成本高、覆盖差。
- Go：仅有 `go fmt`/`go list` 子进程方案，Vercel 不支持。
- Java/Kotlin：JVM 强依赖，serverless 不可行。

**结论**：放弃语言自带 parser 路线，统一走 tree-sitter。

### 2.4 ctags / universal-ctags

**机制**：30+ 年生态的符号索引器，C 实现。
**优**：语言覆盖极广（40+）、速度极快。
**劣**：必须以二进制 / 子进程方式运行，Vercel serverless 不支持；产出仅 symbol + 行号，无签名/参数类型，比当前 TS Compiler 提取**质量倒退**。**否决**。

### 2.5 LLM 提取符号

**机制**：直接给 GPT/Claude 喂代码，让它输出 JSON 化的符号列表与摘要。
**优**：零依赖；可适应任意新语言或 DSL；可同时产出语义摘要（兼并 Phase 2 的 LLM summary 议题）。
**劣**：每文件一次 LLM 调用 → 200 文件 × GPT-4o-mini ≈ $0.2–1/仓；非确定输出，CI 难以 snapshot 测试；延迟最慢；触达率限。
**结论**：作为未来的 enrichment 层（在 AST 切分之上叠加语义摘要），不作为底层切分方案。

### 2.6 GitHub Code Search / Semantic API

**机制**：直接调 GitHub `/repos/.../code-scanning` 与 semantic symbol API。
**优**：零依赖、零计算成本。
**劣**：semantic 仅对部分语言开放且需 enterprise 权限；公开 repo `?q=symbol:...` 不返回结构信息。**否决**。

### 2.7 维持现状（正则强化）

**优**：零变更、零风险。
**劣**：嵌套、修饰符、注释/字符串里的关键字、Kotlin `suspend fun`/`internal`、Python 装饰器+类方法、Rust `pub(crate)` 这些 case 永远只能堆 hack；symbolNames 召回会持续低于 TS 路径，长期拖累检索质量。
**结论**：作为兜底降级路径保留（wasm 加载失败 / query 未覆盖时），不作为主线。

---

## 2.x 方案对比矩阵

| 方案 | 多语言覆盖 | Vercel 兼容 | 依赖体积 | 解析质量 | 维护成本 | 冷启动 | 选用 |
|---|---|---|---|---|---|---|---|
| A. web-tree-sitter (WASM) | 极广（300+） | ✅ 纯 wasm | 0.2–0.5MB/语言 | 高 | 中（query） | 30–80ms/语言 | **主线** |
| B. tree-sitter native | 极广 | ⚠️ prebuilt 矩阵 | 小 | 高 | 中 | 极快 | ❌ |
| C. ast-grep `@ast-grep/napi` | 同 A | ⚠️ napi prebuilt | 中 | 高 | 低（YAML） | 中 | 备选 |
| D. 各语言独立 parser | 差 | 部分 ❌ | 大 | 不均 | 高 | 各异 | ❌ |
| E. ctags | 极广 | ❌ 二进制 | — | 中 | 低 | 进程启动 | ❌ |
| F. LLM 提取 | 全 | ✅ | 0 | 高但不稳 | 低 | 网络延迟 | 未来叠加 |
| G. GitHub Semantic API | 多 | ✅ HTTP | 0 | 中 | 极低 | 网络延迟 | ❌ |
| H. 正则强化 | 全 | ✅ | 0 | 低 | 低 | 0 | 兜底降级 |

**核心约束**：Vercel serverless Node runtime + 零原生编译 + 单一抽象覆盖 ≥ 5 种语言 ⇒ 仅 A 同时满足。C 在质量上等同 A，但 napi 与 Vercel 部署兼容矩阵风险并未消除，不值得为「pattern 更可读」付出。

---

## 2.y 市面成熟方案借鉴（Deep Wiki / Code Intelligence）

下面是 2025–2026 主流"代码理解"产品的切分与索引策略，作为对本方案的横向参照。

### DeepWiki（Cognition / Devin）
- **流水线**：repo URL → 结构分析（目录 + README + config 文件）→ 代码解析引擎（提取函数/类/配置/注释）→ 关系映射（文件/类/函数间引用）→ LLM 摘要 → Markdown wiki + 向量索引。
- **关键观察**：底层仍依赖结构化 AST 提取（未公开具体 parser，业界普遍推测 tree-sitter 系），LLM 仅做"摘要 + 关系归纳"，**不让 LLM 做 AST 工作**。
- **对我们的启示**：当前 spec 的两层结构（AST 切分 + 后续可选 LLM enrichment）方向与 DeepWiki 一致；不要走 LLM 直接切代码的反向路线。

### Sourcegraph Cody / Amp
- **架构**：Code Graph（自研符号图，pre-index 阶段产生 LSIF/SCIP 格式）+ embedding + 全文检索三路融合。
- **关键观察**：tree-sitter 主要用于轻量场景，重场景用 SCIP（每语言一个 indexer：scip-typescript, scip-python, scip-java...）。
- **对我们的启示**：SCIP 是"高保真但重投入"路线（每语言独立 indexer 子进程），不适合 Vercel serverless；我们与 Aider 的轻量路线更契合。Cody 模式适合自托管多仓库长期项目。

### Greptile
- **架构**：构建仓库语义图，跨文件/跨服务依赖追踪，定位为"PR review 时的影响分析"。
- **关键观察**：切分粒度比函数更粗（模块/调用链级别），追求架构理解而非检索召回。
- **对我们的启示**：我们的目标是"Ask Repo 问答"，召回 > 架构图；Greptile 的语义图思路可作为 Phase 3 升级方向，不影响当前 AST 切分基础。

### Aider repo-map
- **架构**：tree-sitter 提取每个文件的顶级声明 → 建立符号引用图 → PageRank 排序 → 在 LLM 上下文里渲染"压缩版仓库地图"。
- **关键观察**：和我们最相似的开源参考实现。tree-sitter + S-expression query 文件就在 `aider/queries/` 下，每语言一份 `.scm`，可直接借鉴语法。
- **对我们的启示**：**直接复用 Aider 的 query 文件作为起点**可节省 R1–R3 的 50% 工作量（Aider 用的是 Apache-2 license，需保留 attribution）。

### Continue (codebase indexing)
- **架构**：本地 SQLite + LanceDB；tree-sitter 提取符号；按 chunkSize 滑动窗口切，每 chunk 一个 embedding。
- **关键观察**：保留了"按 token 滑窗"作为 tree-sitter 的补充，避免大函数被截断。
- **对我们的启示**：可作为 spec #3「大文件二次切分」的具体实现参考：先 AST 切到声明，再对超长声明用 token 窗口二次切。

### GitNexus / CodeGraphContext / Repomix
- **架构**：纯本地，tree-sitter 或正则 + JSON 导出。
- **关键观察**：定位 CLI 工具，假设在用户本机跑；Vercel 场景不适用，但可作为「自托管」备选。

### 横向对比小结

| 产品 | Parser 选型 | 部署形态 | 与我们差异 |
|---|---|---|---|
| DeepWiki | tree-sitter（推测） + LLM 摘要 | SaaS | 我们做更轻量、单仓自查询 |
| Cody | SCIP（重）+ tree-sitter（轻） | 自托管 + SaaS | SCIP 不适合 serverless |
| Greptile | 自研语义图 | SaaS | 粒度更粗，目标差异大 |
| **Aider** | **tree-sitter (.scm queries)** | CLI | **方案最接近，可直接借鉴 query** |
| Continue | tree-sitter + 滑窗 | IDE 本地 | 窗口策略可借鉴 |

**结论**：业界主流的"AST 切分 + 符号图 / 摘要"双层架构与本 spec 推荐方向一致；最大可复用资产是 **Aider 的 tree-sitter `.scm` query 文件**。

---

## 3. 推荐方案：Tree-sitter WASM 统一切分

### 3.1 依赖

```jsonc
// package.json (新增)
{
  "web-tree-sitter": "^0.23.x",
  "tree-sitter-wasms": "^0.x.x"   // 预编译 wasm 集合；或单独装每种语言
}
```

或选择性引入：`tree-sitter-python`、`tree-sitter-go`、`tree-sitter-rust`、`tree-sitter-java`、`tree-sitter-kotlin` 各自的 `.wasm`，按需 lazy load。

### 3.2 抽象层设计

新增 `lib/rag/chunking/parsers/`：
```
parsers/
  index.ts            // 语言 → parser 的注册表
  typescript.ts       // 沿用 ts compiler api（保留，质量更高）
  treesitter.ts       // 通用 wasm 解析器
  queries/
    python.scm
    go.scm
    rust.scm
    java.scm
    kotlin.scm
```

统一接口：
```ts
export interface LanguageParser {
  language: SupportedLanguage;
  extract(filePath: string, content: string): Promise<ExtractedCodeFacts>;
}
```

注册表分发：
```ts
function getParser(filePath: string): LanguageParser {
  const lang = detectLanguage(filePath);
  if (lang === 'ts' || lang === 'js') return typescriptParser;
  return treesitterParser;  // 内部按 lang 加载对应 wasm grammar
}
```

### 3.3 Query 模板

Tree-sitter query 用 S-expression 描述「我要的导出节点」。例：

**Python（`python.scm`）**：
```scheme
; top-level function/class（排除嵌套）
(module
  (function_definition
    name: (identifier) @symbol.function))

(module
  (class_definition
    name: (identifier) @symbol.class))

; 显式 __all__
(module
  (expression_statement
    (assignment
      left: (identifier) @export_marker
      right: (list (string) @symbol.exported))))
```

**Go**：
```scheme
; 大写开头即导出
(source_file
  (function_declaration
    name: (identifier) @symbol.function
    (#match? @symbol.function "^[A-Z]")))

(source_file
  (type_declaration
    (type_spec
      name: (type_identifier) @symbol.type
      (#match? @symbol.type "^[A-Z]"))))
```

**Rust**、**Java**、**Kotlin** 同理（pub / public / 顶层 fun + modifier list）。

每种语言的 query 文件单独可测、可演进，无需改解析器代码。

### 3.4 性能预算
- WASM grammar 首次 `Language.load()` ≈ 30-80ms（每语言一次，cache 在模块作用域）。
- 解析 50KB 文件 ≈ 5-20ms（vs ts compiler 20-60ms）。
- 1 仓 200 文件、混合语言：增量索引下平均仅解析变更文件，单次 ingest 增量耗时 < 1s。

### 3.5 风险
| 风险 | 缓解 |
|---|---|
| Vercel bundle size 增大（每个 wasm 200-500KB） | 仅在 server function 里加载；client 不打包 |
| WASM 解析失败/语法错误 | tree-sitter 容错；fallback 到现有正则提取 |
| Query 表达力不够覆盖所有「导出」语义 | 单语言可分多 query 累加；语言不在白名单时直接跳过 |
| Edge runtime 不支持 wasm filesystem 加载 | 用 `fetch` + `instantiate` 或 base64 inline；ingest 路径走 Node runtime 即可 |

---

## 4. 实施分期建议

| Phase | 内容 | 工作量 |
|---|---|---|
| R1 | 引入 `web-tree-sitter` + Python grammar，作为第二语言验证抽象层 | 1 人日 |
| R2 | 补 Go / Rust 两种 query | 0.5 人日 |
| R3 | 补 Java / Kotlin（模式相似） | 0.5 人日 |
| R4 | 在 `shouldIndexFile` 中放宽多语言扩展名条件（已经允许，但需要确认 query 覆盖） | 0.2 人日 |
| R5 | symbolNames 提取从「正则」切到「query 结果」，对比 baseline 检索质量 | 0.5 人日 |
| R6 | 文档与 query 维护指南 | 0.3 人日 |

总计 ≈ 3 人日。

---

## 5. 决策与下一步

**推荐**：采用 `web-tree-sitter` + 预编译 `.wasm` grammar。

**待用户决策**：
- [ ] 是否同意引入 `web-tree-sitter` 依赖（仅 server bundle）
- [ ] 是否同意分语言渐进上线（R1 仅 Python 先行，验证收益后再扩）
- [ ] 是否需要在 admin report 里加「每语言 symbol 召回率」指标作为质量基线

---

## 6. 参考

- web-tree-sitter — <https://www.npmjs.com/package/web-tree-sitter>
- tree-sitter language pack — <https://github.com/kreuzberg-dev/tree-sitter-language-pack>
- cAST: Structural Chunking via AST (arxiv 2506.15655) — <https://arxiv.org/html/2506.15655v1>
- Building code-chunk: AST Aware Code Chunking (supermemory) — <https://supermemory.ai/blog/building-code-chunk-ast-aware-code-chunking/>
- Semantic Code Indexing with AST and Tree-sitter — <https://medium.com/@email2dineshkuppan/semantic-code-indexing-with-ast-and-tree-sitter-for-ai-agents-part-1-of-3-eb5237ba687a>
- DeepWiki (Cognition / Devin) — <https://cognition.ai/blog/deepwiki>
- Aider repo-map with tree-sitter — <https://aider.chat/2023/10/22/repomap.html>
- Sourcegraph Cody architecture — <https://sourcegraph.com/docs/cody>
- Code Intelligence Tools for AI Agents (Ry Walker) — <https://rywalker.com/research/code-intelligence-tools>
- Continue codebase indexing (DeepWiki) — <https://deepwiki.com/continuedev/continue/3.4-codebase-indexing>
