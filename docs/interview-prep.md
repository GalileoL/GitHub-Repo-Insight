# GitHub Repo Insight — 简历描述 & 面试准备

## 一、简历项目描述

### 项目名称

**GitHub Repo Insight** — 基于 RAG 的 GitHub 仓库智能分析平台

### 简历写法（按点描述）

**项目描述：** 一个全栈 GitHub 仓库分析平台，提供可视化数据看板和 AI 智能问答功能。用户输入任意 GitHub 仓库地址，即可查看语言分布、贡献者排名、Commit 趋势、Issue/PR 统计、Release 时间线等多维度数据图表，并可通过 AI 对仓库内容进行自然语言提问。

**技术栈：** React 19 + TypeScript 5.9 + Vite 7 + TailwindCSS 4 + ECharts 6 + Zustand + TanStack Query 5 + Vercel Serverless + Upstash Vector/Redis + OpenAI API

**核心亮点（选 5-7 条）：**

- 基于 **RAG（检索增强生成）** 架构实现仓库智能问答，支持对 README、Issue、PR、Release、Commit 等多源数据的自然语言查询
- 设计并实现 **混合检索管线**：向量检索（Upstash Vector） + BM25 关键词检索（MiniSearch），通过 **RRF（Reciprocal Rank Fusion）** 融合排序 + 轻量级 Rerank（时效性/内容质量/标题匹配）
- 实现 **查询意图路由**，根据问题语义自动分类为 documentation / community / changes / general，动态过滤检索范围，提升召回精度
- 采用 **SSE（Server-Sent Events）** 实现 LLM 流式输出，前端逐 token 渲染 + 打字光标动画，优化用户等待体验
- 支持 **5 种大模型热切换**（OpenAI / DeepSeek / Groq / Gemini / Claude），统一通过 OpenAI SDK 兼容接口调用，仅需修改环境变量即可切换
- 使用 **GitHub OAuth 2.0** 实现用户认证，基于 Upstash Redis 设计 **每日配额限流**（20 次/天/用户），Admin 用户无限制
- Dashboard 支持 **@dnd-kit 拖拽排序**，卡片顺序持久化至 localStorage；6 个图表组件全部 **lazy-load + Suspense** 实现按需加载
- 使用 **ECharts 6 + CSS Variables** 实现完整 **Light/Dark 主题切换**，图表配色跟随系统主题自适应
- 全栈 TypeScript，Vercel Serverless Functions 零运维部署，GitHub Actions CI 自动执行 lint + type check + build

---

## 二、面试 Q&A 全集

---

### 第一部分：项目整体

**Q1: 简单介绍一下这个项目？**

A: 这是一个全栈 GitHub 仓库分析平台。用户在首页输入仓库地址（如 `vercel/next.js`），可以看到语言分布、贡献者排名、Commit 趋势热力图、Issue/PR 月度统计、Release 时间线等可视化数据。

核心亮点是集成了一个 **RAG（检索增强生成）AI 问答系统**，用户可以用自然语言提问关于仓库的任何问题，系统会从索引的仓库数据中检索相关内容，结合大模型生成回答并附上来源引用。

技术栈是 React 19 + TypeScript + TailwindCSS 4 前端，Vercel Serverless Functions 做后端 API，Upstash Vector 存向量，Upstash Redis 做限流。

---

**Q2: 为什么选择这些技术栈？**

A:
- **React 19 + Vite 7**：最新版本，Vite 开发体验极好，HMR 速度快
- **TailwindCSS 4** 而非 antd：这是一个数据可视化 Dashboard，不是后台管理系统，不需要 Table/Form 组件库。手写组件更灵活，主题切换更可控
- **ECharts 6**：比 Chart.js/Recharts 更强大，支持复杂图表类型（热力图等），tree-shaking 支持好
- **TanStack Query 5**：管理服务端状态（缓存、重试、stale-while-revalidate），比手动 useEffect + useState 好太多
- **Zustand 5**：轻量（<1KB），比 Redux 少很多模板代码，适合这种中小项目
- **Vercel Serverless**：免运维、自动扩缩容、和 Vercel 部署无缝集成
- **Upstash Vector/Redis**：Serverless 架构下不能跑传统数据库，Upstash 是 HTTP-based 的无状态服务，和 Serverless 完美匹配

---

**Q3: 项目的架构是怎样的？**

A: 分三层：

1. **前端 SPA**：React 19 + React Router 7，lazy-load 的路由（首页、Dashboard、AI 分析页、OAuth 回调页）
2. **Serverless API 层**：3 个 RAG 端点（ingest/ask/status）+ 1 个 OAuth 端点，Vercel Functions 运行
3. **外部服务**：GitHub REST API（数据源）、OpenAI API（Embedding + LLM）、Upstash Vector（向量存储）、Upstash Redis（限流计数）

数据流：GitHub API → Fetcher → Chunker → Embedder → Vector DB（ingest），用户提问 → Query Router → Hybrid Search → Rerank → LLM → SSE Stream（ask）

---

### 第二部分：RAG 系统（核心考点）

**Q4: 什么是 RAG？为什么用 RAG 而不是直接让大模型回答？**

A: RAG = Retrieval-Augmented Generation（检索增强生成）。直接让 LLM 回答有两个问题：
1. **幻觉**：LLM 会编造不存在的 Issue 号、PR 内容
2. **时效性**：LLM 训练数据有截止日期，不知道仓库最新状态

RAG 的做法是先从知识库中检索相关文档片段，拼接到 LLM 的 prompt 上下文里，让 LLM 基于真实数据回答。这样既保证了准确性，又可以随时更新知识库（re-index）。

---

**Q5: 你的 RAG 管线设计是怎样的？**

A: 分两个阶段：

**Ingest（索引阶段）：**
1. **Fetch**：用 GitHub API 获取 README、200 条 Issues、50 条 PRs（+ 前 30 的 changed files）、20 条 Releases、100 条 Commits
2. **Chunk**：结构化分块 —— README 按 H1-H3 标题切分，Issue/PR 各自一块（含元数据），Commits 每 10 条一块
3. **Embed**：用 OpenAI `text-embedding-3-small`（1536 维）批量生成向量
4. **Store**：存入 Upstash Vector，每个向量附带 metadata（repo、type、title、url、日期等）

**Ask（查询阶段）：**
1. **Query Router**：根据关键词分类意图（documentation/changes/community/general），确定 typeFilter
2. **Hybrid Search**：vector 语义检索 + MiniSearch BM25 关键词检索并行执行
3. **RRF Merge**：用 Reciprocal Rank Fusion 融合两路排序（K=60），取 top 2×topK
4. **Rerank**：对融合结果做轻量级重排——时效性 +0.15（30 天内）、内容长度加分、标题关键词匹配加分
5. **LLM Generate**：将 top 8 chunks 作为 context 拼入 system prompt，流式生成回答

---

**Q6: 为什么用混合检索而不只用向量检索？**

A: 向量检索擅长语义匹配（"这个仓库的架构设计" → 找到 README 中介绍架构的段落），但对精确查询效果差（"Issue #123" → 向量距离上可能不是最近的）。

关键词检索（BM25）擅长精确匹配，但不理解语义（搜 "性能优化" 找不到说 "speed improvement" 的内容）。

混合检索取两者之长。用 RRF 融合是因为：
- 两种检索的分数不在同一尺度上（cosine similarity vs BM25 score），不能直接加权
- RRF 只依赖排名位置 `1/(K + rank)`，与分数绝对值无关，天然适合异构结果融合
- 实现简单，效果经过学术验证（优于单一检索 5-10%）

---

**Q7: Rerank 具体是怎么做的？为什么不用交叉编码器？**

A: 我的 Rerank 是轻量级的规则打分：
- **时效性加分**（+0.15）：30 天内创建的 chunk 加分，时间相关问题常需要最新数据
- **内容质量**（+0.05/+0.10）：较长的 chunk（>200/>500 字符）通常信息更完整
- **标题匹配**（+0.05/词）：查询词出现在 chunk 标题中说明高关联

没用交叉编码器（如 Cohere Rerank 或 BGE-reranker）的原因：
1. 增加 API 调用延迟（额外 200-500ms）
2. 当前数据量（几百个 chunk）规则 Rerank 已经够用
3. Serverless 环境不适合加载本地模型
4. 如果后续数据量增大，可以接入 Cohere Rerank API

---

**Q8: 查询路由是怎么实现的？**

A: 基于关键词模式匹配，将用户问题分为 4 类：
- **documentation**（readme/文档/使用/安装）→ 只检索 `readme` + `release` 类型
- **changes**（commit/更新/变更/版本）→ 只检索 `commit` + `pr` + `release`
- **community**（issue/bug/问题/贡献者）→ 只检索 `issue` + `pr`
- **general**（默认）→ 检索所有类型

作用是缩小检索范围，减少噪声。比如问 "How to install?" 只搜 README，不会返回无关的 Issue。

---

**Q9: Embedding 用的什么模型？为什么选这个？**

A: `text-embedding-3-small`，1536 维，OpenAI 的最新一代嵌入模型。选它因为：
- 性价比最高（比 ada-002 便宜 5 倍，效果更好）
- 1536 维是精度和存储的平衡（3072 维的 large 版太耗存储）
- Upstash Vector 创建 index 时配置为 1536 维 + COSINE 距离，和模型对齐

---

**Q10: Chunking 策略是怎么设计的？**

A: 不是简单的固定长度切分，而是按**数据结构**切：
- **README**：按标题（H1-H3）切分，每个 section 一个 chunk，过滤太短的（<20 字符），上限 4000 字符
- **Issue**：每个 Issue 一个 chunk，包含标题 + body + labels + state + created_at（方便时间查询）
- **PR**：每个 PR 两个 chunk——一个是描述，一个是 changed files 列表
- **Release**：每个 Release 一个 chunk（tag + name + body + 日期）
- **Commit**：每 10 条一组（避免 chunk 爆炸），包含 message + author + SHA

这比固定 token 切分好，因为保留了文档的语义边界，检索时 chunk 的内容完整性更高。

---

### 第三部分：流式输出

**Q11: 流式输出是怎么实现的？**

A: 全链路 SSE（Server-Sent Events）：

**后端：**
- 调用 LLM API 时传 `stream: true`，拿到一个 AsyncGenerator
- 逐个 yield delta（文本片段），用 `res.write()` 写 SSE 事件格式：`data: {"type":"delta","content":"..."}\n\n`
- 最后发送 sources 和 `[DONE]` 信号
- 设置 `Content-Type: text/event-stream`、`Cache-Control: no-cache`

**前端：**
- 用 `fetch()` + `ReadableStream` 读取响应 body
- 逐行解析 SSE 格式（`data: ...`），解析 JSON
- 用 `useState` 的 setter 函数追加文本：`setAnswer(prev => prev + delta)`
- AnswerCard 组件在 streaming 状态下显示一个 teal 色的闪烁光标

**为什么用 SSE 而不是 WebSocket？**
- SSE 是单向的（服务器→客户端），完全满足 LLM 流式输出的需求
- HTTP 协议，和 Vercel Serverless 兼容（WebSocket 在 Serverless 上不稳定）
- 浏览器原生支持 `EventSource`，但这里用 fetch + ReadableStream 是因为需要发 POST 请求

---

### 第四部分：前端架构

**Q12: TanStack Query 和 Zustand 分别管理什么状态？**

A:
- **TanStack Query（服务端状态）**：GitHub API 数据（repo 信息、languages、contributors、commit activity、releases、issues）、RAG 状态（index status）
- **Zustand（客户端状态）**：认证信息（token + user）、主题偏好（light/dark/system）

划分原则：有明确 "数据源" 且需要缓存/重试/去重的用 TanStack Query；纯客户端的 UI 状态用 Zustand。不用 Redux 是因为 Zustand 更轻量（<1KB），状态逻辑不复杂不需要 middleware。

---

**Q13: 图表组件是怎么做性能优化的？**

A:
1. **Lazy loading**：6 个图表组件全部 `lazy(() => import(...))`，只在进入 Dashboard 页面时按需加载
2. **Suspense**：每个图表有独立的 Suspense + skeleton fallback，不会因为一个图表阻塞整个页面
3. **ECharts tree-shaking**：只导入用到的图表类型（Line、Bar、Pie、Heatmap），不引入完整 ECharts
4. **memo**：RepoOverview 用 `React.memo()` 避免图表区域 rerender 导致 overview 重渲染
5. **Vite chunk splitting**：ECharts 打包到独立 chunk（547KB），浏览器可独立缓存

---

**Q14: 拖拽排序是怎么实现的？**

A: 用 `@dnd-kit`（现代 React 拖拽库，替代 react-beautiful-dnd）：
- `DndContext` + `SortableContext` 包裹卡片列表
- 每个卡片用 `useSortable` hook 获取拖拽属性
- `PointerSensor` 配置 8px 激活距离（避免误触）
- `closestCenter` 碰撞检测算法
- 拖拽结束后 `arrayMove` 调换顺序，保存到 `localStorage`
- hover 时右上角显示拖拽手柄 (≡)

---

**Q15: 路由是怎么设计的？有做过性能优化吗？**

A: 4 个路由，全部 lazy-load：
- `/` — 首页（搜索 + 热门仓库 + 历史记录）
- `/repo/:owner/:repo` — Dashboard（含拖拽图表）
- `/repo/:owner/:repo/analyze` — AI 问答
- `/auth/callback` — OAuth 回调

性能优化：
- 所有页面组件用 `React.lazy()` 动态导入
- `MainLayout` 作为共享 layout（Navbar 一直在），内部用 `<Outlet />` + `<Suspense>` 切换页面
- 首屏只加载 HomePage，其他页面按需加载

---

**Q16: 主题切换是怎么实现的？**

A: 三种模式：light / dark / system。

- Zustand store 管理 `themeMode`，持久化到 `localStorage`
- `main.tsx` 启动时根据模式设置 `document.documentElement.className`
- system 模式下监听 `matchMedia('prefers-color-scheme: dark')` 变化事件
- ECharts 主题通过 **CSS Variables** 同步：在 echarts-theme.ts 里读取 `getComputedStyle` 的 CSS 变量值动态生成配色
- TailwindCSS 4 用 `@custom-variant dark (&:where(.dark, .dark *))` 定义暗色变体

---

**Q30: Release Timeline 的虚拟列表是怎么实现的？定高还是不定高？**

A: 不定高虚拟列表，使用 `@tanstack/react-virtual` v3 的 `useVirtualizer`。

**为什么是不定高：**
每个 release item 会显示 release notes 摘要（`body` 字段），不同 release 的说明内容长短不一：有的 release 只有 tag（无 body，约 60-64px），有的有完整发布说明（2 行截断，约 92-96px）。内容差异自然产生高度差。

**实现原理：**
- `ref={virtualizer.measureElement}` + `data-index={virtualItem.index}` 挂载到每个 item 的 DOM 节点上
- TanStack Virtual v3 内部使用 **ResizeObserver** 在首次渲染后测量每个节点的真实高度
- `estimateSize: () => 80` 只是初始估值（无 body ~64px、有 body ~96px 的中间值），ResizeObserver 测量后会覆盖
- 每个 item 用 `position: absolute` + `transform: translateY(${virtualItem.start}px)` 定位，`virtualItem.start` 基于所有前序 item 的实测高度累加

**release notes 渲染细节：**
- `stripMarkdown()` 函数（module scope）剥离 markdown 标记，输出纯文本
- `[...text].slice(0, 160).join('')` 按 Unicode code point 截断（避免 emoji 截断出现乱码）
- `line-clamp-2` CSS 属性二次截断，保证显示最多 2 行
- CSS clamping 在首次 paint 后稳定，不会触发 ResizeObserver 的循环

**对比定高虚拟列表：** 定高只需要 `estimateSize: () => ITEM_HEIGHT` 一个固定值，不需要 `measureElement`。不定高的关键是 `measureElement` 让 DOM 量取代公式计算，代价是首次渲染后有一次 layout 测量。

---

### 第五部分：后端 & 认证 & 安全

**Q17: 认证流程是怎样的？**

A: 标准 OAuth 2.0 Authorization Code Flow：

1. 前端跳转 GitHub 授权页（带 `client_id` + `redirect_uri`）
2. 用户授权后 GitHub 回调 `/auth/callback?code=xxx`
3. 前端拿 `code` 发 POST 到 `/api/auth/github`
4. **后端**用 `client_id` + `client_secret` + `code` 换取 `access_token`（client_secret 只在服务端，不暴露给前端）
5. 前端存 token 到 Zustand store（持久化到 localStorage）
6. 后续 API 请求带 `Authorization: Bearer <token>` 头

**追问：为什么把 GitHub OAuth token 存在 localStorage？这样安全吗？**

A: 这是一个有明确 trade-off 的选择。

- **风险是存在的**：localStorage 里的 token 如果遇到 XSS，可以被恶意脚本读取
- **但在这个项目里风险可控**：我申请的 GitHub OAuth scope 很小，只有 `read:user`，即使 token 泄露，也只能读取用户基础信息，不能读写仓库、更不能执行危险操作
- **为什么没有上 httpOnly cookie**：这是一个纯前端 SPA + Serverless API 的项目，没有单独的 session 服务。如果要改成 httpOnly cookie，意味着要引入 BFF/session 体系，复杂度会上升很多
- **我的设计思路**：先做最小权限申请、避免 `dangerouslySetInnerHTML`、不把 secret 暴露到前端，在项目规模和安全收益之间做平衡
- **如果是生产级高敏系统**：我会改成服务端 session + httpOnly cookie，而不是把 access token 暴露给浏览器 JavaScript

---

**Q18: 限流是怎么设计的？**

A: 基于 Upstash Redis 的 **每日滑动窗口计数器**：
- Key 格式：`rag:usage:{login}:{YYYY-MM-DD}`
- 每次提问 `INCR` 计数，首次设置 48h TTL 自动清理
- 普通用户：20 次/天
- Admin 用户（env 配置）：无限制
- 响应头带 `X-RateLimit-Limit` 和 `X-RateLimit-Remaining`

为什么用 Redis 而不是内存计数？Serverless 函数每次冷启动内存不共享，必须用外部存储。

---

**Q19: 为什么选 Vercel Serverless 而不是 Express/Koa？**

A:
1. **免运维**：不需要自己管理服务器、进程守护、负载均衡
2. **自动扩缩容**：流量高时自动扩容，无流量时零成本
3. **和前端部署一体**：Vite build + Serverless Functions 在同一个 Vercel 项目中
4. **冷启动时间可接受**：Node.js runtime 冷启动约 200-500ms

缺点是不能跑长连接（WebSocket 不稳定），但 SSE 是 HTTP 协议所以可以。

---

**Q20: Upstash Vector 和传统向量数据库（Pinecone/Weaviate/Milvus）的区别？**

A: Upstash Vector 主要特点：
- **HTTP-based**：通过 REST API 调用，不需要 TCP 连接池，和 Serverless 完美匹配
- **按请求计费**：没有固定费用，空闲时零成本
- **无需运维**：不用自己部署 Docker，托管服务
- 对比 Pinecone：Upstash 更便宜（有免费额度），但功能少一些（没有 namespace、metadata index）
- 对比 Milvus/Weaviate：那些需要自建服务器，不适合 Serverless

---

### 第六部分：工程化

**Q21: CI/CD 流程是怎样的？**

A:
- **CI**：GitHub Actions，PR 到 main 或 push 到 main 时自动执行 `tsc -b` + `eslint` + `vite build`
- **CD**：Vercel Git 集成，main 分支有变化自动部署
- **分支策略**：feature branch → PR → CI 通过 → merge to main → Vercel 自动部署
- **Concurrency**：同一 PR 多次 push 会取消旧的 CI 运行

---

**Q22: 你在开发过程中遇到过哪些问题？怎么解决的？**

A:
1. **Vercel Dev 递归调用**：`npm run dev` → `vercel dev` → Vercel 读取 Development Command 又是 `npm run dev`，死循环。解决：改 Vercel 项目设置，或直接用 `npx vercel dev`
2. **Ingest 500 错误**：一开始不知道哪一步出错（auth?  fetch?  embed?  vector?），在 ingest endpoint 加了分步 try-catch 日志，定位到是 GitHub token 验证问题
3. **RAG 回答质量差**：只抓了 50 条 Issue，对 next.js（24K+ Issues 的大仓库）覆盖不够。改为 200 条 + 分页 + 加入 labels/state/date 等元数据增强 chunk 内容
4. **GitHub API 202 响应**：Commit Activity 端点返回 202（数据正在计算），需要延时重试。封装了 `githubFetchWithRetry` 带指数退避

---

**Q23: 这个项目有什么局限性？如果要改进，你会怎么做？**

A: 主要局限：
1. **Issue 数据量有限**：只索引 200 条，大仓库覆盖不够。改进：加 GitHub API `since` 参数做增量索引，或者接入 GitHub GraphQL API 批量获取
2. **统计类问题 RAG 不擅长**："一共有多少 Issue" 这种需要全量聚合的问题，RAG 只能基于索引的 200 条回答。改进：对数量类问题直接调 GitHub API 查询，不走 RAG
3. **没有向量缓存**：每次提问都重新 embed query。改进：对相似问题做 query embedding 缓存
4. **没有增量更新**：re-index 是全量重建。改进：记录 last sync timestamp，只获取新增数据
5. **Rerank 不够精准**：规则打分不如模型打分。改进：接入 Cohere Rerank API

---

### 第七部分：多模型支持

**Q24: 如何实现多模型切换的？**

A: 利用了 OpenAI SDK 的 **兼容接口** 特性 —— DeepSeek、Groq、Gemini、Claude 都提供了和 OpenAI 格式相同的 API 端点。

实现方式：
- 一个 `LLM_CONFIG` 映射表，每个 provider 定义 `baseURL`、`model`、`envKey`
- `getProvider()` 读 `LLM_PROVIDER` 环境变量
- `getClient()` 用 OpenAI SDK 创建客户端，只是 baseURL 不同
- 切换模型只需改一个环境变量，零代码改动

这个设计的好处：
1. 依赖收敛 —— 不需要安装 5 个不同的 SDK
2. 统一接口 —— streaming、非 streaming 的代码路径完全一致
3. 可扩展 —— 加新模型只需在 config 表加一行

---

### 第八部分：高频八股关联

**Q25: 项目中用到了哪些设计模式？**

A:
- **策略模式**：LLM 多模型配置（LLM_CONFIG 映射表，运行时选择策略）
- **工厂模式**：`getClient()` 根据 provider 创建不同配置的 OpenAI 客户端
- **观察者模式**：Zustand subscribe 监听主题变化、TanStack Query 的 cache invalidation
- **组合模式**：SectionCard 包裹不同图表组件，统一外观
- **装饰器/中间件模式**：`githubFetchWithRetry` 对 fetch 的重试包装

---

**Q26: 如何保证前端性能？**

A:
- **代码分割**：React.lazy + Suspense，路由级 + 组件级按需加载
- **Tree-shaking**：ECharts 只导入所需模块（Line/Bar/Pie/Heatmap/Calendar）
- **缓存策略**：TanStack Query 5 分钟 staleTime，避免重复请求
- **Memo**：RepoOverview 用 React.memo 避免子树重渲染
- **不定高虚拟列表**：Release Timeline 使用 `@tanstack/react-virtual` v3 实现虚拟滚动，每个 item 展示 release notes 摘要（`line-clamp-2`），高度各异；通过 `measureElement` ref + ResizeObserver 实时测量每个 DOM 节点真实高度，替代硬编码 `ITEM_HEIGHT` 常量，实现真正的动态高度虚拟列表
- 最终 bundle：主 JS 48KB gzip，ECharts 184KB gzip，首屏只加载主 JS

---

**Q27: 项目的安全性是怎么考虑的？**

A:
- **OAuth client_secret 仅在服务端**：前端只有 client_id，token 交换在 Serverless Function 中完成
- **OAuth token 的权限最小化**：只申请 GitHub `read:user` scope，降低 token 泄露后的影响面
- **localStorage 方案是可控 trade-off**：我知道它有 XSS 风险，但结合最小权限 scope 和当前项目形态，复杂度与收益是平衡的
- **输入校验**：repo 格式用正则校验（防注入），question 长度限制 500 字符
- **身份验证**：ingest 和 ask 端点都需要 GitHub token，服务端调 GitHub /user API 验证
- **限流防滥用**：每日 20 次配额，防止恶意刷 LLM API
- **CORS**：Vercel 默认只允许同域请求
- **敏感信息**：API Key 全部在服务端环境变量，不暴露到前端（只有 `VITE_` 前缀的才会打包到客户端）

---

**Q28: TypeScript 在项目中发挥了什么作用？**

A: 全栈 TypeScript（前端 + Serverless Functions + 共享类型）：
- `lib/rag/types.ts` 定义的 `Chunk`、`ScoredChunk`、`AskResponse` 等类型在前后端共享
- `GitHubRepo`、`GitHubApiError` 等接口在 API 层严格类型化
- Zod 做运行时校验（用户输入的 repo 格式），TypeScript 做编译时检查
- CI 中 `tsc -b` 保证构建前无类型错误
- 实际效果：在开发 RAG 管线时，类型推断帮我发现了多处字段遗漏（比如 `metadata.createdAt` 可选属性的处理）

---

**Q29: 如果让你从零重做这个项目，有什么会做不同的？**

A:
1. **一开始就设计增量索引**：避免每次全量 re-index
2. **考虑用 GraphQL API**：GitHub REST API 有些数据需要多次请求，GraphQL 一次就能拿到
3. **加入单元测试**：特别是 chunking、rerank、router 这些核心逻辑
4. **用 React Server Components**：如果用 Next.js 而不是纯 Vite，Dashboard 页面的数据可以在服务端获取，减少客户端请求
5. **抽出 RAG SDK**：把 embedding + retrieval + rerank 抽成独立包，方便复用到其他项目
