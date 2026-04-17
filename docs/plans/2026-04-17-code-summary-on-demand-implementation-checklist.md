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
- **Implementation status**: Phase 1-6 complete, Phase 7 (docs) in progress
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
| `code_summary` 提取器 | Completed | 100% | `code-summary.ts` + 30+ 单测全通过 |
| ingest 接入 | Completed | 100% | 文件树拉取、两阶段优先级排序、chunk 生成、ingest 编排 |
| K1 检索隔离 | Completed | 100% | queryCategory 透传、keyword search 排除 code_summary |
| K2 物理拆分 | Completed | 100% | `fetchCoreRepoChunks` / `fetchCodeSummaryChunks` 用 `range({prefix})` 按 chunk-ID 前缀物理隔离 |
| ask code fetch stage | Completed | 100% | 按需回源、symbol 窗口、超时退化、LLM prompt 更新 |
| Eval 事件写入 | Completed | 100% | retrieval/code_fetch/answer 已写；`failedFiles` 现在带 classified `reason`（Gemini 建议 3 落地） |
| Feedback endpoint | Not started | 0% | Task 6.3 — thumbs up/down 独立 endpoint 待做 |
| 测试设计 | Partial | 60% | 提取器、router、keyword isolation、code-fetch 行为测试已补；更高层 retrieval 集成测试待补 |

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

- **Status**: Completed
- **Goal**: 在改逻辑前确认测试入口和约束，不然后面很难稳定迭代
- **Owner suggestion**: 先做

### TODO

- [x] 确认 `lib/**/*.test.ts` 当前是否已被 Vitest 覆盖
- [x] 如果未覆盖，调整 `vitest.config.ts`
- [x] 明确哪些模块适合纯单元测试，哪些要做集成测试
- [x] 为 GitHub fetch / Upstash / Redis 交互设计 mock 入口

### Acceptance

- `lib/` 下新增测试文件可以被 `pnpm test` 执行
- 可以在不访问真实 GitHub / Upstash 的情况下测试核心逻辑

### Handoff Note

- 如果 Phase 0 没做，后续模型很容易直接开始写实现，最后只能靠手跑和 debug，接手成本会明显上升

---

## Phase 1: Types and Routing

- **Status**: Completed
- **Goal**: 先把类型系统和 query routing 调整到位，给后续实现建立稳定接口

### Task 1.1: Extend shared types

- **Files**: `lib/rag/types.ts`
- **Progress**: 100%

#### TODO

- [x] 在 `ChunkType` 中新增 `code_summary`
- [x] 在 `QueryCategory` 中新增 `code`
- [x] 为 `ChunkMetadata` 增加：
  - [x] `symbolNames?: string[]`
  - [x] `symbolsTruncated?: boolean`
  - [x] `language?: string`
  - [x] `summaryTruncated?: boolean`
- [x] 新增 code fetch eval 类型
- [x] 新增 retrieval/answer eval 类型

#### Acceptance

- `tsc` 通过
- 所有现有 import 不因为类型破坏而报错

### Task 1.2: Add code query routing

- **Files**: `lib/rag/retrieval/router.ts`
- **Progress**: 100%

#### TODO

- [x] 给代码相关 query pattern 返回 `category: 'code'`
- [x] 为 code query 设置包含 `code_summary` 的 `typeFilter`
- [x] 保持原有 documentation/community/changes/general 行为不回归

#### Acceptance

- “where is / function / class / module / source / file” 等 query 能进入 `code`
- 非代码问题不误入 `code`

### Phase 1 Exit Criteria

- [x] 类型层改完
- [x] 路由层改完
- [x] 路由单测补齐

---

## Phase 2: Code Summary Extractor

- **Status**: Completed
- **Goal**: 做出一个稳定、低成本、可预测的 TS/JS 摘要提取器

### Task 2.1: Create extractor skeleton

- **Files**: `lib/rag/chunking/code-summary.ts`
- **Progress**: 100%

#### TODO

- [x] 定义 `ExtractedCodeFacts` 中间结构
- [x] 实现 `extractCodeFacts(filePath, content)` 主入口
- [x] 实现 `renderCodeSummary(facts)`，输出半结构化文本
- [x] 实现 `buildCodeSummaryChunk(...)`
- [x] 定义 chunk ID 格式：`{repo}:code:{filePath}`（SHA 放 metadata `lastIndexedSha` 字段，不编码进 ID）

### Task 2.2: Implement file filtering

- **Progress**: 100%

#### TODO

- [x] 仅允许 `src/**`, `lib/**`, `api/**`
- [x] 排除：
  - [x] `**/*.test.*`
  - [x] `**/*.spec.*`
  - [x] `**/dist/**`
  - [x] `**/build/**`
  - [x] `**/coverage/**`
  - [x] `**/node_modules/**`
  - [x] `**/*.min.*`
  - [x] 明显 generated 文件
- [x] 增加单文件大小上限

### Task 2.3: Implement TS/JS AST extraction

- **Progress**: 100%

#### TODO

- [x] 用 `ts.createSourceFile(...)` 解析源码
- [x] 提取 exported functions/classes/interfaces/types/const/default
- [x] 提取 top-level signatures
- [x] 提取 import paths
- [x] 提取文件级注释/JSDoc
- [x] 提取有限的 internal helpers
- [x] 生成 `kindHints`

### Task 2.4: Metadata shaping

- **Progress**: 100%

#### TODO

- [x] 生成 `symbolNames`
- [x] 控制 `symbolNames` 上限
- [x] 给超限场景设置 `symbolsTruncated`
- [x] 给摘要超限场景设置 `summaryTruncated`
- [x] 记录 `language`

### Task 2.5: Fallback extraction

- **Progress**: 100%

#### TODO

- [x] 为非 TS/JS 文件实现 very-light regex fallback
- [x] Phase 1 先覆盖 Python/Go/Rust/Java/Kotlin 的最小规则
- [x] 对于无法提取的文件，直接跳过，不抛硬错误

### Task 2.6: Tests

- **Progress**: 100%

#### TODO

- [x] 测 exported symbol 提取
- [x] 测 internal helper 截断
- [x] 测 kind hint 判定
- [x] 测文件白名单/黑名单
- [x] 测摘要长度截断
- [x] 测 fallback regex

### Acceptance

- 单个文件可稳定输出摘要
- 同一输入多次运行输出一致
- 不依赖 LLM、不访问网络

### Handoff Note

- 这个阶段是最适合 TDD 的部分；如果时间不够，优先把这里的测试骨架做出来，后续接手最容易

---

## Phase 3: Ingest Integration

- **Status**: Completed
- **Goal**: 让 ingest 真的生成并上载 `code_summary`

### Task 3.1: Fetch source files

- **Files**: `lib/rag/github/fetchers.ts`
- **Progress**: 100%

#### TODO

- [x] 增加 repo 文件树抓取能力
- [x] 拉取候选源码文件内容
- [x] 对文件数做 cap（Phase 1 默认上限：`200`，允许后续调优）
- [x] 对文件筛选应用白名单和大小限制
- [x] 为后续增量索引预留 `lastIndexedSha` 信息
- [x] 实现两阶段文件优先级排序：
  - [x] 第一阶段（保底层）：白名单入口路径硬保留（`api/**/*.ts`、`lib/**/index.ts`、`src/App.tsx` 等）
  - [x] 第二阶段（竞争层）：剩余 slot 按综合热度分排序
  - [x] 数据源：PR changedFiles、commit message 路径/文件名命中、fetch 后的 export-count 重排、fileSize 反向

### Task 3.2: Generate code summary chunks

- **Files**: `lib/rag/chunking/index.ts`
- **Progress**: 100%

#### TODO

- [x] 在现有 readme/issues/pulls/releases/commits 之外接入 `code_summary`
- [x] 保持现有 chunk 行为不回归
- [x] 对大型 repo 做 cap 控制

### Task 3.3: Update ingest orchestration

- **Files**: `api/rag/ingest.ts`
- **Progress**: 100%

#### TODO

- [x] ingest 时包含代码摘要 chunk
- [x] 保持原有 re-index 逻辑正确
- [x] 记录摘要 chunk 数量，必要时单独打日志

### Acceptance

- 一个仓库完成 ingest 后，向量库里出现 `code_summary`
- 原有非代码 chunk 不受影响
- 超大仓不会因为代码摘要而失控

### Risk

- 当前 ingest 是全量重建，代码摘要引入后耗时会上升；如果这一步超时，需要优先观察而不是立刻引入复杂增量索引

---

## Phase 4: K1/K2 Retrieval Isolation

- **Status**: Completed (K1 logical isolation + K2 physical prefix scan shipped; tests pending)
- **Goal**: 把代码检索从当前通用关键词检索路径中隔离出来

### Task 4.1: K1 logical isolation

- **Files**: `lib/rag/retrieval/hybrid.ts`, `lib/rag/retrieval/keyword.ts`
- **Progress**: 100%

#### TODO

- [x] `hybridSearch` 接收 `queryCategory`
- [x] `keywordSearch` 接收 `queryCategory`
- [x] 非 code query 默认不加载 `code_summary`
- [x] code query 才加载 `code_summary`

### Task 4.2: K2 storage split

- **Files**: `lib/rag/storage/index.ts`
- **Progress**: 100% (物理拆分完成：chunk ID 前缀驱动的 `range({prefix})` 调用)

#### TODO

- [x] 拆出 `fetchCoreRepoChunks(...)` — 并行扫描 readme/issue/pr/release/commits 前缀
- [x] 拆出 `fetchCodeSummaryChunks(...)` — `prefix: "${repo}:code:"`
- [x] 明确区分“逻辑拆分”与“物理返回量下降”
- [x] Upstash `range({prefix})` POC：`@upstash/vector@1.2.3` 的 `RangeCommandPayload` 支持 `prefix`（不支持 metadata filter），这是物理 K2 的落地路径
- [x] `fetchAllRepoChunks` 保留为兼容入口，内部调用两个拆分函数

### Task 4.3: Keyword search behavior tests

- **Progress**: 100%

#### TODO

- [x] 测 non-code query 不混入 `code_summary`
- [x] 测 code query 能搜到 `code_summary`
- [x] 测 K1/K2 改动不破坏现有搜索结果形态

### Acceptance

- `code_summary` 只在 code path 参与关键词检索
- 非代码问题的检索延迟没有明显回归

### Handoff Note

- 这个阶段是“最容易名义完成、实际没解决问题”的地方。接手模型要主动验证底层读取量是否真的下降，不能只看函数命名

---

## Phase 5: Ask Code Fetch Stage

- **Status**: Completed (tests pending)
- **Goal**: 在问答阶段按需回源源码，并保持失败可退化

### Task 5.1: Add file content fetcher

- **Files**: `lib/rag/github/fetchers.ts`
- **Progress**: 100% (新增 `fetchFileContentDetailed` 带错误分类；旧 `fetchFileContent` 保留为 null-fallback 兼容入口)

#### TODO

- [x] 实现 `fetchFileContent(...)`
- [x] 首选 contents API
- [x] 明确 404 / 403 / timeout / rate limit 的错误分类（`FileFetchFailureReason = 'not_found' | 'forbidden' | 'too_large' | 'timeout' | 'rate_limited' | 'unknown'`；由 `fetchFileContentDetailed` 返回）
- [x] 对 `>100KB` 文件直接放弃（Phase 1 默认阈值，允许后续调优）
- [ ] 视情况预留 blob/tree fallback（仍归入后续任务；当前单 GET 配 2.5s AbortController 已足够）

### Task 5.2: Insert code fetch stage into ask.ts

- **Files**: `api/rag/ask.ts`
- **Progress**: 100%

#### TODO

- [x] 在 `rerank` 后、`generateAnswer` 前插入 `codeFetchStage`
- [x] 只在 `category === 'code'` 时启用
- [x] 从命中 chunk 中提取 `filePath`
- [x] 用 rerank score + filepath hit + symbol hit + entry-point hit 给候选文件打分
- [x] 最多拉取 3 个文件
- [x] 设置 strict timeout：Phase 1 默认值为 **2s per file，总超时 3s**（使用 `Promise.race` 与 AbortController，允许后续调优）
- [x] 失败时退化到 summary-only

### Task 5.3: Windowed code extraction

- **Progress**: 100%

#### TODO

- [x] query 命中 `symbolNames` 时，定位 symbol 附近窗口
  - **定位方式**：在 code fetch 阶段用正则 in 拉到的文件中实时搜索 symbol 名称，截取前后各 50-100 行（不在 AST 提取阶段记录行号，避免 metadata 膨胀且行号会因代码变更而过时）
- [x] 没命中 symbol 时，从文件头截断
- [x] 单文件字符上限：Phase 1 默认值 `2500 chars`
- [x] 总代码上下文字符上限：Phase 1 默认值 `6000 chars`
- [x] 截断时保证 prompt 仍可读

### Task 5.4: LLM context integration

- **Files**: `lib/rag/llm/index.ts`, `api/rag/ask.ts`
- **Progress**: 100%

#### TODO

- [x] 为 prompt 增加“实时源码优先于摘要”的规则
- [x] 保持 analytics context 与 code context 可并存
- [x] 避免 code context 破坏现有 source citation 行为

### Task 5.5: Tests

- **Progress**: 100%

#### TODO

- [x] 测 code query 命中后会触发回源
- [x] 测 GitHub fetch 失败时退化
- [x] 测 symbol window 截取优先
- [x] 测超大文件被跳过
- [x] 测 non-code query 不触发回源

### Acceptance

- 用户问代码实现问题时，answer context 中会出现实时源码
- GitHub API 失败不会让主问答直接失败

---

## Phase 6: Evaluation Pipeline

- **Status**: Partial (events + helpers + reason classification shipped; feedback endpoint outstanding)
- **Goal**: 给代码检索和回源效果建立可量化记录

### Task 6.1: Add storage helpers

- **Files**: `lib/rag/storage/index.ts`
- **Progress**: 100%

#### TODO

- [x] 新增 `writeEvalEvent(...)`
- [x] 新增 `writeEvalFeedback(...)`
- [x] key 使用 `rag:eval:{requestId}`
- [x] 24h TTL

### Task 6.2: Write retrieval/code_fetch/answer events

- **Files**: `api/rag/ask.ts`
- **Progress**: 100% (`failedFiles[i].reason` 现在透传 `FileFetchFailureReason`)

#### TODO

- [x] 写 `retrieval`
- [x] code path 写 `code_fetch`
- [x] 写 `answer`
- [x] 失败路径写 `fallbackReason`
- [x] 记录 `matchedBy`, `selectedFiles`, `failedFiles`, `usedSummaryOnlyFallback`
  - [x] **follow-up**: `failedFiles[i].reason` 现在取自 `fetchFileContentDetailed`，包含 `not_found | forbidden | too_large | timeout | rate_limited | unknown`（Gemini 建议 3 落地）

### Task 6.3: Feedback wiring

- **Files**: `api/rag/share.ts` and/or new `api/rag/feedback.ts`
- **Progress**: 0% (listed in Remaining work)

#### TODO

- [ ] `shareCreated` 顺带写 eval
- [ ] `userRetried` / thumbs up/down 用独立 endpoint 或最小侵入方案上报

### Acceptance

- 单次 ask 后 Redis 中能看到完整 hash
- 可以区分“召回失败”“回源失败”“上下文截断”

---

## Phase 7: Documentation Sync and Hardening

- **Status**: In progress
- **Goal**: 实现完成后收尾，避免知识漂移

### TODO

- [ ] 根据真实实现更新 `Memory.md`
- [ ] 如果有用户可见能力变化，再更新 `README.md`
- [ ] 补充实现说明到 `discussion/summary.md` 之外的长期文档
- [ ] 记录 Phase 2 待办：多语言规则、namespace、增量索引、K2 物理过滤 POC、`failedFiles` reason 分类、两阶段文件优先级排序

### Acceptance

- 新实现和项目记忆文档一致
- 后续模型不需要重读整轮讨论也能理解能力边界

---

## Phase 8: Production-Grade Monitoring System (Revised)

- **Status**: Not started
- **Goal**: 构建分布式、低耦合的监控体系，拆分为“索引化日报管线”和“带抑制机制的实时告警”两套子系统。

### Phase 8 Fixed Decisions

- 继续使用 `rag:eval:{requestId}` 作为请求级明细存储，不新增第二份事件明细结构。
- 日报聚合不再依赖 `SCAN rag:eval:*`，改为基于按天索引的 requestId 集合。
- 实时告警必须使用 Redis 状态，而不是进程内内存计数。
- 告警发送必须经过 notifier 抽象层，不允许业务代码直接调用 Resend/Webhook SDK。
- `feedback` 采集属于监控闭环的一部分，但不阻塞日报与告警主链路先落地。

### Phase 8 Tunable Defaults

以下为 Phase 8 的默认值，属于初始建议值，不是不可变规范：

- `rag:eval:index:{YYYY-MM-DD}` 默认 TTL：`48h`
- 告警抑制窗口默认值：`1h`
- GitHub rate limit 低水位默认阈值：`100`
- timeout streak 默认阈值：`5`
- 日报执行时间默认值：每日 `01:00`

建议后续实现时对应环境变量：
- `EVAL_INDEX_TTL_HOURS`
- `ALERT_SUPPRESS_SECONDS`
- `ALERT_GITHUB_RATE_LIMIT_REMAINING`
- `ALERT_TIMEOUT_STREAK`

### Task 8.1: Secondary Indexing for Daily Reporting

- **Files**: `lib/rag/storage/index.ts`
- **Progress**: 0%

#### TODO

- [ ] 修改 `writeEvalEvent`，在写入 Hash 的同时，将 `requestId` 存入 Redis Set：`rag:eval:index:{YYYY-MM-DD}`。
- [ ] 为索引 Set 设置可配置 TTL，Phase 1 默认值 `48h`。
- [ ] 明确索引粒度为 `requestId`，同一请求多次 `writeEvalEvent` 只通过 `SADD` 去重一次。
- [ ] 在实现说明中写清楚：请求量按 request 统计，不按 event field 数量统计。

### Task 8.2: Distributed Alerting Logic

- **Files**: `lib/admin/alert-manager.ts` (New)
- **Progress**: 0%

#### TODO

- [ ] 将告警分成两类：
  - [ ] `streak-based alerts`：例如连续 timeout / 连续 5xx
  - [ ] `threshold-based alerts`：例如 GitHub rate limit 过低
- [ ] 为 `streak-based alerts` 实现 Redis `INCR` 计数，并明确 reset 语义：
  - [ ] 失败时递增
  - [ ] 成功时清零或删除 counter key
- [ ] 为 `threshold-based alerts` 实现无状态阈值检查，不引入无意义的 streak counter。
- [ ] 实现告警抑制：发送告警前检查 suppress key，发送后写入 suppress key。
- [ ] 将 suppress key 粒度明确为至少 `rag:alert:suppress:{type}:{repo}`，必要时允许扩展到 `:{route}`。
- [ ] 集成到 `ask.ts` 和 `ingest.ts` 的错误处理路径，但不要在底层 fetcher 中直接发通知。

### Task 8.3: Notifier Abstraction Layer

- **Files**: `lib/admin/notifier.ts` (New)
- **Progress**: 0%

#### TODO

- [ ] 定义 `NotificationPayload` 接口。
- [ ] 暴露统一入口，例如 `sendOpsNotification(payload)`。
- [ ] 实现多通道降级链路：
  - [ ] 实时告警默认 `Webhook -> Resend -> structured log`
  - [ ] 日报默认 `Resend -> structured log`
- [ ] 支持根据告警级别（INFO/WARN/CRITICAL）和通知场景（daily report / live alert）路由不同通道。
- [ ] 约定在无外部通知能力时，`structured log` 也算最小可运行退化。

### Task 8.4: Indexed Daily Aggregator

- **Files**: `lib/admin/metrics-aggregator.ts` (New), `lib/admin/report-renderer.ts` (New)
- **Progress**: 0%

#### TODO

- [ ] 从近两天的 `rag:eval:index:{YYYY-MM-DD}` 读取 requestId 列表，再按 event timestamp 截最近 24h。
- [ ] 使用 `SMEMBERS`/批量读取替代全库 `SCAN`。
- [ ] 并行（Batch）拉取 `rag:eval:{requestId}` Hash 数据进行指标计算。
- [ ] 第一版核心指标至少包含：
  - [ ] total requests
  - [ ] query category distribution
  - [ ] code fetch trigger rate
  - [ ] fetch success rate
  - [ ] summary-only fallback rate
  - [ ] top selected files
  - [ ] failure reason distribution
  - [ ] `answerUsedRetrievedCode` ratio
- [ ] 将日报渲染逻辑放入 `report-renderer.ts`，不要把模板拼接塞进 route。
- [ ] “与昨日对比”的趋势指标标记为 stretch goal，不阻塞第一版上线。

### Task 8.5: Reporting Endpoint and Cron

- **Files**: `api/admin/report.ts`, `vercel.json`
- **Progress**: 0%

#### TODO

- [ ] 将 `api/admin/report.ts` 保持为薄 orchestration 层，只负责鉴权、调用 aggregator 和 notifier。
- [ ] 校验 `CRON_SECRET`，阻止未授权调用。
- [ ] 部署每日凌晨的 Cron Job。
- [ ] 支持手动调用日报接口做 smoke test。

### Task 8.6: Feedback Capture Endpoint

- **Files**: `api/rag/feedback.ts`
- **Progress**: 0%

#### TODO

- [ ] 补齐 `feedback` 接口，允许前端回写用户赞/踩数据。
- [ ] 复用现有 `writeEvalFeedback`，避免新增平行存储模型。
- [ ] 明确 feedback 是 request 级补充字段，不改变日报主聚合口径。

### Acceptance

- [ ] 连续模拟 10 次相同错误，验证 suppress window 内仅收到 1 次高优先级通知。
- [ ] 调用日报接口，验证是否通过按天索引快速生成最近 24h 报表，而不是扫描全量 `rag:eval:*`。
- [ ] 关闭外部通知能力，验证告警和日报都能降级输出到 structured log。
- [ ] 验证同一 `requestId` 多次写 `retrieval/code_fetch/answer/feedback` 后，请求量统计仍然只记 1 次。

### Handoff Note

- 请接手模型优先确认 `RESEND_API_KEY` 是否已在环境变量中就位。
- 若要接入 webhook 通道，请同时确认对应的 webhook endpoint / secret 是否已就位。
- 索引 Set 对 Redis 存储有一定开销，需关注大流量下的内存占用。
- 第一版先保证“日报 + 实时告警 + feedback 采集”三者解耦，不要为了趋势分析把 Phase 8 做成重型报表系统。

---

## 9. Immediate Next Step

如果不开始实现监控，推荐顺序是：
1. 补齐 `router` 的集成测试。
2. 调优 `Phase 3` 的文件优先级打分。
