# Code Summary + On-Demand Fetch Implementation Checklist

> 目的：把 `discussion/round-01` 到 `round-03` 的结论整理成一份可直接执行、可中途接手、可检查进度的实施清单。
>
> 适用场景：
> - 当前模型做到一半触发限制，后续模型需要无缝接手
> - 需要明确“已经定稿什么”“还没做什么”“下一步该改哪些文件”
> - 需要把实现拆成可以逐步验收的小任务，而不是一次性大改

---

## 1. Current Status Snapshot

- **Plan status**: Ready for implementation
- **Implementation status**: In progress (Phase 1 done, Phase 2 extractor done, tests blocked by env issue)
- **Discussion status**: Finalized through `discussion/summary.md` (`Current Round: round-03`)
- **Primary goal**: 为 Ask Repo 增加“源码摘要索引 + 按需回源源码”能力，并补齐结构化评估记录
- **Out of scope for Phase 1**:
  - LLM 摘要生成
  - 全量源码向量索引
  - Python/Go 等多语言高精度 AST 支持
  - Upstash namespace 正式启用

### 1.1 Overall Progress

| Area | Status | Progress | Notes |
|------|--------|----------|------|
| 架构方向 | Completed | 100% | 讨论已收敛：`code_summary + on-demand fetch` |
| 类型与路由设计 | Completed | 100% | `types.ts` + `router.ts` 改完，tsc+lint 通过 |
| `code_summary` 提取器 | In Progress | 80% | `code-summary.ts` 实现完成，测试已写但被 rollup native 环境问题阻塞 |
| ingest 接入 | Planned | 0% | Cap、白名单、metadata 规则已定 |
| ask code fetch stage | Planned | 0% | 插入点、退化逻辑、超时策略已定 |
| K1/K2 检索隔离 | Planned | 0% | 逻辑分离已定，物理分离实现待验证 |
| Eval 事件写入 | Planned | 0% | Redis Hash schema 已定 |
| 测试设计 | Planned | 0% | 适合先测后写，详见末尾 TDD 判断 |

### 1.2 Fixed Decisions

- 使用 `code_summary` 新 chunk type，不做全文代码入向量库
- 新增 `QueryCategory: 'code'`
- 摘要生成：`TypeScript Compiler API` 优先，正则降级，不引入 LLM
- Ask 路径：`rerank` 之后新增 `codeFetchStage`
- 文件回源：最多并行拉取 3 个文件，建议 strict timeout，失败降级到 summary-only
- 超大文件：`>100KB` 直接放弃回源
- 评估记录：Redis Hash，key 为 `rag:eval:{requestId}`
- K2 至少要做到“代码摘要读取与常规 chunk 读取逻辑分离”；是否做到真正物理 IO 分离，要在实现时验证

### 1.3 Tunable Defaults

以下项目属于 **Phase 1 默认值**，不是不可变规范。实现时应先按这些值落地，再结合测试、真实联调和指标数据调整：

- 文件 cap 默认上限：`200`
- 代码回源默认并行上限：`3 files`
- code fetch timeout 默认值：
  - `2s per file`
  - `3s total`
- 代码上下文默认截断：
  - `2500 chars per file`
  - `6000 chars total`
- 超大文件默认跳过阈值：`>100KB`
- `symbolNames` 默认上限：实现时先使用保守阈值，并记录 `symbolsTruncated`
- 文件优先级排序默认权重：
  - `changeFrequency × 0.4`
  - `prHitCount × 0.3`
  - `exportCount × 0.2`
  - `fileSize` 反向 × `0.1`

这些默认值的目标是给第一版实现一个稳定起点，而不是替代后续调优。

---

## 2. Handoff Rules

### 2.1 接手时先确认的事实

- 当前代码库里**还没有**以下实现：
  - `ChunkType = 'code_summary'`
  - `QueryCategory = 'code'`
  - `lib/rag/chunking/code-summary.ts`
  - `ask.ts` 中的 `codeFetchStage`
  - `rag:eval:{requestId}` 的阶段化写入
- 讨论文档是事实来源，优先级：
  1. `discussion/summary.md`
  2. `discussion/round-03/*.md`
  3. 本文档

### 2.2 接手人不要重新争论的事项

- 不要把 LLM 摘要加回 ingest 主路径
- 不要把 Phase 1 扩展成全语言 AST 平台
- 不要把 namespace 当作当前方案落地前置条件
- 不要把“API 拆了两个函数”误认为已经完成 K2

### 2.3 接手人要重点验证的事项

- Upstash Vector `range()` 是否真的支持当前项目需要的服务端过滤能力
- `symbolNames` metadata 大小是否逼近 Upstash metadata 限制
- `fetchFileContent` 的 GitHub 回源策略在路径编码、404、403、超时情况下是否稳定

---

## 3. File Map

| File | Action | Priority | Purpose |
|------|--------|----------|---------|
| `lib/rag/types.ts` | Modify | P0 | 新增 `code_summary`、`code` category、code/eval metadata 类型 |
| `lib/rag/chunking/index.ts` | Modify | P0 | 接入代码摘要 chunk 生成 |
| `lib/rag/chunking/code-summary.ts` | Create | P0 | 实现 TS/JS 摘要提取器 |
| `lib/rag/github/fetchers.ts` | Modify | P0 | 扩展源码文件树/源码内容拉取能力 |
| `api/rag/ingest.ts` | Modify | P0 | 让 ingest 生成并上载 `code_summary` |
| `lib/rag/retrieval/router.ts` | Modify | P0 | 引入 `code` category |
| `lib/rag/retrieval/hybrid.ts` | Modify | P0 | 透传 `queryCategory` 到 keyword path |
| `lib/rag/retrieval/keyword.ts` | Modify | P0 | 实现 K1/K2 的关键词检索分层 |
| `lib/rag/storage/index.ts` | Modify | P0 | 读取拆分、eval 写入、可选 namespace 预留 |
| `api/rag/ask.ts` | Modify | P0 | 插入 code fetch stage、写 eval 事件 |
| `lib/rag/llm/index.ts` | Modify | P1 | prompt/context 规则支持实时源码 |
| `lib/rag/chunking/code-summary.test.ts` | Create | P0 | 摘要提取器单测 |
| `lib/rag/retrieval/router.test.ts` 或相关测试文件 | Create/Modify | P1 | code query 路由测试 |
| `api/rag/ask` 相关测试 | Create/Modify | P1 | code fetch stage 行为测试 |
| `README.md` / `Memory.md` | Maybe modify | P2 | 实现完成后按需同步文档 |

---

## 4. Execution Phases

## Phase 0: Guardrails and Test Harness

- **Status**: Not started
- **Goal**: 在改逻辑前确认测试入口和约束，不然后面很难稳定迭代
- **Owner suggestion**: 先做

### TODO

- [ ] 确认 `lib/**/*.test.ts` 当前是否已被 Vitest 覆盖
- [ ] 如果未覆盖，调整 `vitest.config.ts`
- [ ] 明确哪些模块适合纯单元测试，哪些要做集成测试
- [ ] 为 GitHub fetch / Upstash / Redis 交互设计 mock 入口

### Acceptance

- `lib/` 下新增测试文件可以被 `pnpm test` 执行
- 可以在不访问真实 GitHub / Upstash 的情况下测试核心逻辑

### Handoff Note

- 如果 Phase 0 没做，后续模型很容易直接开始写实现，最后只能靠手跑和 debug，接手成本会明显上升

---

## Phase 1: Types and Routing

- **Status**: Not started
- **Goal**: 先把类型系统和 query routing 调整到位，给后续实现建立稳定接口

### Task 1.1: Extend shared types

- **Files**: `lib/rag/types.ts`
- **Progress**: 0%

#### TODO

- [ ] 在 `ChunkType` 中新增 `code_summary`
- [ ] 在 `QueryCategory` 中新增 `code`
- [ ] 为 `ChunkMetadata` 增加：
  - [ ] `symbolNames?: string[]`
  - [ ] `symbolsTruncated?: boolean`
  - [ ] `language?: string`
  - [ ] `summaryTruncated?: boolean`
- [ ] 新增 code fetch eval 类型
- [ ] 新增 retrieval/answer eval 类型

#### Acceptance

- `tsc` 通过
- 所有现有 import 不因为类型破坏而报错

### Task 1.2: Add code query routing

- **Files**: `lib/rag/retrieval/router.ts`
- **Progress**: 0%

#### TODO

- [ ] 给代码相关 query pattern 返回 `category: 'code'`
- [ ] 为 code query 设置包含 `code_summary` 的 `typeFilter`
- [ ] 保持原有 documentation/community/changes/general 行为不回归

#### Acceptance

- “where is / function / class / module / source / file” 等 query 能进入 `code`
- 非代码问题不误入 `code`

### Phase 1 Exit Criteria

- [ ] 类型层改完
- [ ] 路由层改完
- [ ] 路由单测补齐

---

## Phase 2: Code Summary Extractor

- **Status**: Not started
- **Goal**: 做出一个稳定、低成本、可预测的 TS/JS 摘要提取器

### Task 2.1: Create extractor skeleton

- **Files**: `lib/rag/chunking/code-summary.ts`
- **Progress**: 0%

#### TODO

- [ ] 定义 `ExtractedCodeFacts` 中间结构
- [ ] 实现 `extractCodeFacts(filePath, content)` 主入口
- [ ] 实现 `renderCodeSummary(facts)`，输出半结构化文本
- [ ] 实现 `buildCodeSummaryChunk(...)`
- [ ] 定义 chunk ID 格式：`{repo}:code:{filePath}`（SHA 放 metadata `lastIndexedSha` 字段，不编码进 ID）

### Task 2.2: Implement file filtering

- **Progress**: 0%

#### TODO

- [ ] 仅允许 `src/**`, `lib/**`, `api/**`
- [ ] 排除：
  - [ ] `**/*.test.*`
  - [ ] `**/*.spec.*`
  - [ ] `**/dist/**`
  - [ ] `**/build/**`
  - [ ] `**/coverage/**`
  - [ ] `**/node_modules/**`
  - [ ] `**/*.min.*`
  - [ ] 明显 generated 文件
- [ ] 增加单文件大小上限

### Task 2.3: Implement TS/JS AST extraction

- **Progress**: 0%

#### TODO

- [ ] 用 `ts.createSourceFile(...)` 解析源码
- [ ] 提取 exported functions/classes/interfaces/types/const/default
- [ ] 提取 top-level signatures
- [ ] 提取 import paths
- [ ] 提取文件级注释/JSDoc
- [ ] 提取有限的 internal helpers
- [ ] 生成 `kindHints`

### Task 2.4: Metadata shaping

- **Progress**: 0%

#### TODO

- [ ] 生成 `symbolNames`
- [ ] 控制 `symbolNames` 上限
- [ ] 给超限场景设置 `symbolsTruncated`
- [ ] 给摘要超限场景设置 `summaryTruncated`
- [ ] 记录 `language`

### Task 2.5: Fallback extraction

- **Progress**: 0%

#### TODO

- [ ] 为非 TS/JS 文件实现 very-light regex fallback
- [ ] Phase 1 先覆盖 Python/Go/Rust/Java/Kotlin 的最小规则
- [ ] 对于无法提取的文件，直接跳过，不抛硬错误

### Task 2.6: Tests

- **Progress**: 0%

#### TODO

- [ ] 测 exported symbol 提取
- [ ] 测 internal helper 截断
- [ ] 测 kind hint 判定
- [ ] 测文件白名单/黑名单
- [ ] 测摘要长度截断
- [ ] 测 fallback regex

### Acceptance

- 单个文件可稳定输出摘要
- 同一输入多次运行输出一致
- 不依赖 LLM、不访问网络

### Handoff Note

- 这个阶段是最适合 TDD 的部分；如果时间不够，优先把这里的测试骨架做出来，后续接手最容易

---

## Phase 3: Ingest Integration

- **Status**: Not started
- **Goal**: 让 ingest 真的生成并上载 `code_summary`

### Task 3.1: Fetch source files

- **Files**: `lib/rag/github/fetchers.ts`
- **Progress**: 0%

#### TODO

- [ ] 增加 repo 文件树抓取能力
- [ ] 拉取候选源码文件内容
- [ ] 对文件数做 cap（Phase 1 默认上限：`200`，允许后续调优）
- [ ] 对文件筛选应用白名单和大小限制
- [ ] 为后续增量索引预留 `lastIndexedSha` 信息
- [ ] 实现两阶段文件优先级排序：
  - 第一阶段（保底层）：白名单入口路径硬保留（`api/**/*.ts`、`lib/**/index.ts`、`src/App.tsx` 等），预估 10-30 slot
  - 第二阶段（竞争层）：剩余 slot 按综合热度分排序，初始建议权重：`changeFrequency × 0.4 + prHitCount × 0.3 + exportCount × 0.2 + fileSize反向 × 0.1`
  - 数据源：commit history（ingest 已拉取）、PR changedFiles（已有）、exports（AST 提取）

### Task 3.2: Generate code summary chunks

- **Files**: `lib/rag/chunking/index.ts`
- **Progress**: 0%

#### TODO

- [ ] 在现有 readme/issues/pulls/releases/commits 之外接入 `code_summary`
- [ ] 保持现有 chunk 行为不回归
- [ ] 对大型 repo 做 cap 控制

### Task 3.3: Update ingest orchestration

- **Files**: `api/rag/ingest.ts`
- **Progress**: 0%

#### TODO

- [ ] ingest 时包含代码摘要 chunk
- [ ] 保持原有 re-index 逻辑正确
- [ ] 记录摘要 chunk 数量，必要时单独打日志

### Acceptance

- 一个仓库完成 ingest 后，向量库里出现 `code_summary`
- 原有非代码 chunk 不受影响
- 超大仓不会因为代码摘要而失控

### Risk

- 当前 ingest 是全量重建，代码摘要引入后耗时会上升；如果这一步超时，需要优先观察而不是立刻引入复杂增量索引

---

## Phase 4: K1/K2 Retrieval Isolation

- **Status**: Not started
- **Goal**: 把代码检索从当前通用关键词检索路径中隔离出来

### Task 4.1: K1 logical isolation

- **Files**: `lib/rag/retrieval/hybrid.ts`, `lib/rag/retrieval/keyword.ts`
- **Progress**: 0%

#### TODO

- [ ] `hybridSearch` 接收 `queryCategory`
- [ ] `keywordSearch` 接收 `queryCategory`
- [ ] 非 code query 默认不加载 `code_summary`
- [ ] code query 才加载 `code_summary`

### Task 4.2: K2 storage split

- **Files**: `lib/rag/storage/index.ts`
- **Progress**: 0%

#### TODO

- [ ] 拆出 `fetchCoreRepoChunks(...)`
- [ ] 拆出 `fetchCodeSummaryChunks(...)`
- [ ] 明确区分“逻辑拆分”与“物理返回量下降”
- [ ] 尝试使用 Upstash filter 降低返回量
- [ ] 如果 filter 不够，记录为后续 namespace/cache 任务，不在这一步硬扩 scope

### Task 4.3: Keyword search behavior tests

- **Progress**: 0%

#### TODO

- [ ] 测 non-code query 不混入 `code_summary`
- [ ] 测 code query 能搜到 `code_summary`
- [ ] 测 K1/K2 改动不破坏现有搜索结果形态

### Acceptance

- `code_summary` 只在 code path 参与关键词检索
- 非代码问题的检索延迟没有明显回归

### Handoff Note

- 这个阶段是“最容易名义完成、实际没解决问题”的地方。接手模型要主动验证底层读取量是否真的下降，不能只看函数命名

---

## Phase 5: Ask Code Fetch Stage

- **Status**: Not started
- **Goal**: 在问答阶段按需回源源码，并保持失败可退化

### Task 5.1: Add file content fetcher

- **Files**: `lib/rag/github/fetchers.ts`
- **Progress**: 0%

#### TODO

- [ ] 实现 `fetchFileContent(...)`
- [ ] 首选 contents API
- [ ] 明确 404 / 403 / timeout / rate limit 的错误分类
- [ ] 对 `>100KB` 文件直接放弃（Phase 1 默认阈值，允许后续调优）
- [ ] 视情况预留 blob/tree fallback

### Task 5.2: Insert code fetch stage into ask.ts

- **Files**: `api/rag/ask.ts`
- **Progress**: 0%

#### TODO

- [ ] 在 `rerank` 后、`generateAnswer` 前插入 `codeFetchStage`
- [ ] 只在 `category === 'code'` 时启用
- [ ] 从命中 chunk 中提取 `filePath`
- [ ] 用 rerank score + filepath hit + symbol hit + entry-point hit 给候选文件打分
- [ ] 最多拉取 3 个文件
- [ ] 设置 strict timeout：Phase 1 默认值为 **2s per file，总超时 3s**（使用 `Promise.race` 与 AbortController，允许后续调优）
- [ ] 失败时退化到 summary-only

### Task 5.3: Windowed code extraction

- **Progress**: 0%

#### TODO

- [ ] query 命中 `symbolNames` 时，定位 symbol 附近窗口
  - **定位方式**：在 code fetch 阶段用正则在拉到的文件中实时搜索 symbol 名称，截取前后各 50-100 行（不在 AST 提取阶段记录行号，避免 metadata 膨胀且行号会因代码变更而过时）
- [ ] 没命中 symbol 时，从文件头截断
- [ ] 单文件字符上限：Phase 1 默认值 `2500 chars`
- [ ] 总代码上下文字符上限：Phase 1 默认值 `6000 chars`
- [ ] 截断时保证 prompt 仍可读

### Task 5.4: LLM context integration

- **Files**: `lib/rag/llm/index.ts`, `api/rag/ask.ts`
- **Progress**: 0%

#### TODO

- [ ] 为 prompt 增加“实时源码优先于摘要”的规则
- [ ] 保持 analytics context 与 code context 可并存
- [ ] 避免 code context 破坏现有 source citation 行为

### Task 5.5: Tests

- **Progress**: 0%

#### TODO

- [ ] 测 code query 命中后会触发回源
- [ ] 测 GitHub fetch 失败时退化
- [ ] 测 symbol window 截取优先
- [ ] 测超大文件被跳过
- [ ] 测非 code query 不触发回源

### Acceptance

- 用户问代码实现问题时，answer context 中会出现实时源码
- GitHub API 失败不会让主问答直接失败

---

## Phase 6: Evaluation Pipeline

- **Status**: Not started
- **Goal**: 给代码检索和回源效果建立可量化记录

### Task 6.1: Add storage helpers

- **Files**: `lib/rag/storage/index.ts`
- **Progress**: 0%

#### TODO

- [ ] 新增 `writeEvalEvent(...)`
- [ ] 新增 `writeEvalFeedback(...)`
- [ ] key 使用 `rag:eval:{requestId}`
- [ ] 24h TTL

### Task 6.2: Write retrieval/code_fetch/answer events

- **Files**: `api/rag/ask.ts`
- **Progress**: 0%

#### TODO

- [ ] 写 `retrieval`
- [ ] code path 写 `code_fetch`
- [ ] 写 `answer`
- [ ] 失败路径写 `fallbackReason`
- [ ] 记录 `matchedBy`, `selectedFiles`, `failedFiles`, `usedSummaryOnlyFallback`

### Task 6.3: Feedback wiring

- **Files**: `api/rag/share.ts` and/or new `api/rag/feedback.ts`
- **Progress**: 0%

#### TODO

- [ ] `shareCreated` 顺带写 eval
- [ ] `userRetried` / thumbs up/down 用独立 endpoint 或最小侵入方案上报

### Acceptance

- 单次 ask 后 Redis 中能看到完整 hash
- 可以区分“召回失败”“回源失败”“上下文截断”

---

## Phase 7: Documentation Sync and Hardening

- **Status**: Not started
- **Goal**: 实现完成后收尾，避免知识漂移

### TODO

- [ ] 根据真实实现更新 `Memory.md`
- [ ] 如果有用户可见能力变化，再更新 `README.md`
- [ ] 补充实现说明到 `discussion/summary.md` 之外的长期文档
- [ ] 记录 Phase 2 待办：多语言规则、namespace、增量索引

### Acceptance

- 新实现和项目记忆文档一致
- 后续模型不需要重读整轮讨论也能理解能力边界

---

## 5. Suggested Work Breakdown for Multiple Models

### Worker A: Types + Router + Storage Eval Skeleton

- `lib/rag/types.ts`
- `lib/rag/retrieval/router.ts`
- `lib/rag/storage/index.ts` 中的 eval helper

### Worker B: Code Summary Extractor + Tests

- `lib/rag/chunking/code-summary.ts`
- 对应 unit tests

### Worker C: Ingest Integration

- `lib/rag/github/fetchers.ts`
- `lib/rag/chunking/index.ts`
- `api/rag/ingest.ts`

### Worker D: Ask Code Fetch Stage

- `api/rag/ask.ts`
- `lib/rag/llm/index.ts`
- 相关 tests

### Worker E: Retrieval Isolation

- `lib/rag/retrieval/hybrid.ts`
- `lib/rag/retrieval/keyword.ts`
- `lib/rag/storage/index.ts` 中的 chunk fetch split

### Coordination Notes

- `types.ts` 必须优先，因为后续多条线都会依赖
- `code-summary.ts` 和 `ask.ts` 可以并行，但双方要对齐 metadata shape
- `storage/index.ts` 是共享热点文件，按以下分区规则避免冲突：
  - **Worker A（eval helper）**：只在文件末尾新增 `writeEvalEvent` / `writeEvalFeedback` 函数，不修改已有函数
  - **Worker E（chunk fetch split）**：只在 `fetchAllRepoChunks` 附近新增 `fetchCoreRepoChunks` / `fetchCodeSummaryChunks`，不触碰 eval 区域
  - 两者互不交叉，合并时无冲突

---

## 6. Checklists for Handoff

## 6.1 If handing off mid-implementation

下一位模型接手前应先补充：

- [ ] 已修改文件列表
- [ ] 已完成阶段
- [ ] 未完成 TODO
- [ ] 当前失败的测试或 lint
- [ ] 是否存在临时 stub / mock / TODO 注释

建议把这些内容直接附加到本文档最底部，不要散落在聊天里。

## 6.2 Progress Log Template

接手时可复制以下模板：

```md
## Progress Update (YYYY-MM-DD HH:mm)

- Current phase:
- Completed:
  - 
- In progress:
  - 
- Blocked:
  - 
- Next recommended step:
  - 
- Files touched:
  - 
- Tests run:
  - 
- Known risks:
  - 
```

---

## 7. Validation Strategy

## 7.1 Minimum test set per phase

- Phase 1:
  - router unit tests
  - type compile check
- Phase 2:
  - extractor unit tests
- Phase 3:
  - targeted ingest tests or mocked chunk generation tests
- Phase 4:
  - keyword/hybrid retrieval tests
- Phase 5:
  - mocked `ask.ts` code fetch flow tests
- Phase 6:
  - Redis helper tests or mocked storage tests

## 7.2 Final pre-commit checks

按仓库要求，提交前必须跑：

1. `pnpm exec tsc -b`
2. `pnpm lint`
3. `pnpm test`
4. `pnpm exec vite build`

---

## 8. Is This Suitable for TDD?

**结论：适合，但不是 100% 全栈纯 TDD；更准确地说，它适合“分层 TDD”。**

### 非常适合 TDD 的部分

- `router.ts` 的 code category 判定
- `code-summary.ts` 的 AST 提取逻辑
- `symbolNames` / 截断 / metadata shaping
- `keyword.ts` 的 K1/K2 行为分支
- `ask.ts` 中的候选文件评分和窗口截取逻辑
- eval object 的组装逻辑

### 只适合“mock 驱动测试”的部分

- GitHub 文件内容回源
- Upstash Vector filter 行为
- Redis HSET/TTL 写入

这些部分仍然应该先写测试，但测试更多是：
- mock 外部依赖
- 验证调用路径和退化策略
- 验证错误分类

### 不建议强行纯 TDD 的部分

- 第一次打通 ingest -> retrieval -> ask 的端到端联调

因为这里牵涉外部 API、serverless 运行时、上下文长度和性能问题，最终还是需要一轮真实联调验证。做法上更合理的是：

1. **先用 TDD 完成纯逻辑层**
2. **再做少量集成测试**
3. **最后做真实环境 smoke test**

### 推荐测试顺序

1. 先写 `router` 测试
2. 再写 `code-summary` 测试
3. 再写 `ask codeFetchStage` 的 mocked 行为测试
4. 再写 `storage/eval` 测试
5. 最后做一轮端到端 smoke test

**简短判断**：
- 如果你问“这个工作适不适合 test-driven development？”答案是：**适合，而且最好这么做**
- 如果你问“能不能完全靠 TDD 覆盖到生产风险？”答案是：**不能，最后仍需要真实联调和性能验证**

---

## 9. Immediate Next Step

如果现在开始实现，推荐顺序是：

1. Phase 0：先确认测试入口
2. Phase 1：改 `types.ts` + `router.ts`
3. Phase 2：写 `code-summary.ts` 及其测试

这是最稳的起手式，因为它最容易被后续模型接手，而且能最快把核心接口固定下来。

---

## Progress Update (2026-04-17 14:30)

- Current phase: Phase 2 (extractor complete, environment blocker resolved)
- Completed:
  - Phase 0: Confirmed `test/` directory structure, vitest config includes `test/**/*.test.ts`
  - Phase 1 Task 1.1: `lib/rag/types.ts` — added `code_summary` ChunkType, `code` QueryCategory, `ChunkMetadata` new fields (`symbolNames`, `symbolsTruncated`, `language`, `summaryTruncated`, `lastIndexedSha`), `ExtractedCodeFacts` interface, 3 eval event interfaces
  - Phase 1 Task 1.2: `lib/rag/retrieval/router.ts` — filePatterns now route to `category: 'code'` with `typeFilter: ['code_summary', 'pr', 'commit', 'readme']`; added extra code patterns (`method`, `handler`, `hook`, `component`, `import`, `export`)
  - Phase 2 Tasks 2.1-2.5: `lib/rag/chunking/code-summary.ts` — full implementation: file filtering, TS/JS AST extraction via `ts.createSourceFile`, regex fallback for py/go/rs/java/kt, semi-structured rendering, chunk building with symbolNames truncation, batch processing
  - Phase 2 Task 2.6: `test/unit/lib/rag/chunking/code-summary.test.ts` — 30+ test cases written covering all modules
- In progress:
  - None
- Blocked:
  - `pnpm lint` still reports pre-existing `react-hooks/set-state-in-effect` violations in `src/features/rag/components/AnswerCard.tsx` and `src/pages/AuthCallback.tsx`.
  - `pnpm exec tsc -b` passes cleanly on the current tree.
- Next recommended step:
  - Proceed to Phase 3 (ingest integration) and Phase 4 (K1/K2 isolation)
  - Keep using the pnpm + WASM/WASI dependency path already captured in `package.json` and `scripts/`
- Files touched:
  - `lib/rag/types.ts` (modified)
  - `lib/rag/retrieval/router.ts` (modified)
  - `lib/rag/chunking/code-summary.ts` (created)
  - `test/unit/lib/rag/chunking/code-summary.test.ts` (created)
- Tests run:
  - `pnpm exec tsc -b` ✅
  - `pnpm test` ✅
  - `pnpm build` ✅
  - `pnpm lint` ❌ (pre-existing frontend hook-rule violations outside this feature)
- Known risks:
  - None from our changes; all are additive type/interface extensions and a new file
