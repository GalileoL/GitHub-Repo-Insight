# Troubleshooting Log

本文件记录开发过程中遇到的所有问题及解决方案。

---

## 1. `vercel dev` 递归调用报错

**错误信息：**
```
Error: `vercel dev` must not recursively invoke itself.
Check the Development Command in the Project Settings or the `dev` script in `package.json`
```

**原因：** `package.json` 的 `dev` 脚本设为 `vercel dev`，而 `vercel dev` 启动时会自动读取 `dev` 脚本来启动前端，导致无限递归。

**解决：** 把 `dev` 脚本改回 `vite`，另加 `dev:api` 跑 `vercel dev`：
```json
"dev": "vite",
"dev:api": "vercel dev"
```

---

## 2. Ingest 返回 500（OpenAI API Key 无效）

**错误信息：**
```
401 Incorrect API key provided: sk-pPkVY****59Cq
```

**原因：** `.env` 里的 `OPENAI_API_KEY` 为空或填入了无效的 key。嵌入向量（embeddings）始终需要 OpenAI，即使 LLM 用 DeepSeek 也一样。

**解决：** 到 [platform.openai.com/api-keys](https://platform.openai.com/api-keys) 创建有效 key，填入 `.env` 的 `OPENAI_API_KEY`，然后重启 `vercel dev`。

---

## 3. Upstash Vector 创建索引类型选错

**错误信息：** 无明确报错，但 upsert 可能会因缺少 sparse embedding 而失败。

**原因：** 创建 Upstash Vector Index 时选了 **Hybrid** 类型，我们的代码只用 dense embedding（OpenAI text-embedding-3-small），不需要 sparse embedding。

**解决：** 创建 Vector Index 时选择 **Dense** 类型，1536 维度，Cosine 距离。

---

## 4. `countRepoChunks` 和 `deleteRepoChunks` 返回 0（零向量 + Cosine 问题）

**现象：** Ingest 成功（Upstash 控制台能看到数据），但 `/api/rag/status` 返回 `{ indexed: false, chunkCount: 0 }`，导致前端始终显示 "Index this repository first"。

**原因：** `countRepoChunks` 和 `deleteRepoChunks` 使用 `new Array(1536).fill(0)`（全零向量）做 cosine 查询。Cosine similarity 计算涉及除以向量模长，全零向量模长为 0，数学上无意义，Upstash 直接返回空结果。

**解决：** 改用 Upstash 的 `range` API 遍历所有向量，按 metadata 中的 `repo` 字段过滤和计数，不依赖向量查询。

**涉及文件：** `lib/rag/storage/index.ts`

---

## 5. `keywordSearch` 始终返回空结果（同样的零向量问题）

**现象：** Ask 功能的关键词搜索完全失效，hybrid search 退化为纯向量搜索，检索质量差。

**原因：** `keywordSearch` 函数使用全零向量 `queryVectors(new Array(1536).fill(0), 500, filter)` 来获取所有 chunks 并构建 MiniSearch 索引，同样因 cosine + 零向量返回空。

**解决：** 新增 `fetchAllRepoChunks` 函数，使用 `range` API 遍历获取所有 chunks，替代零向量查询。

**涉及文件：** `lib/rag/storage/index.ts`（新增 `fetchAllRepoChunks`）、`lib/rag/retrieval/keyword.ts`（改用新函数）

---

## 6. LLM 无法回答时间相关问题（"最近十天有多少 issue"）

**现象：** LLM 回答"无法确定"或只找到 1 个 issue，而 GitHub 上明明有很多。

**原因（双重）：**

1. **Chunk content 缺少时间信息：** `createdAt` 存在 metadata 里但没有写进 content 文本，LLM 只看 content 所以不知道日期。
2. **数据拉取量不足：** Issues 只抓 50 open + 50 closed = 100 个，且按 `updated` 排序。对于 vercel/next.js 这种大仓库，最近 10 天新建的 issue 可能根本不在这 100 条里。

**解决：**

- Chunker（issues/pulls/releases/commits）把日期、作者、状态信息写入 content 文本
- Issue fetcher 改为 4 路并行：按 `updated` 和 `created` 各拉 100 open + 100 closed，去重后约 200-300 条
- PR fetcher 同理改为 2 路并行去重
- LLM system prompt 注入当前日期，指导 LLM 利用时间信息做统计

**涉及文件：**
- `lib/rag/chunking/issues.ts`、`pulls.ts`、`releases.ts`、`commits.ts`
- `lib/rag/github/fetchers.ts`
- `lib/rag/llm/index.ts`
- `lib/rag/types.ts`（RawIssue/RawPull 新增 `user` 字段）

---

## 通用提醒

- 修改 `.env` 后需要**重启 `vercel dev`** 才能生效
- 修改 chunker 或 fetcher 后需要**点 Re-index** 重新索引才能看到效果
- GitHub OAuth 回调地址在本地开发时应为 `http://localhost:3000/auth/callback`
- Upstash 免费版有请求限制，大量索引时注意不要超

---

## 7. Markdown 渲染没有识别 `##` 标题（显示成纯文本）

**现象**：在答复中出现以 `##` 开头的文本（例如 `## Overview ...`），界面却渲染为普通段落，而不是标题。

**原因**：我们的自研 Markdown 解析器原本只识别段落、列表、代码块、引用和表格，不会将 `#` 处理为标题，因此 `##` 的字符会被当作普通文本保留。

**解决**：在 `src/utils/markdown-parser.tsx` 中增加对 Markdown 标题的解析（`#`~`######`），并在 `AnswerCard` 渲染时将其输出为 `<h1>`~`<h6>`。

> ✅ 同时做了一个小优化：如果 LLM 输出了一行类似 `## Overview The repository is ...` 这样“标题 + 直接跟着正文”，会把标题拆成一行 `<h2>Overview</h2>` + 一段普通段落，避免标题渲染成超长文本。

---

## 8. 页面卡死 / 大文本渲染性能问题

**现象**：回答非常长时，界面可能卡顿甚至挂死（尤其是在计算差异、渲染大量 sources 时）。

**原因**：
- `diffWords` 对超长文本执行差异计算会占用大量 CPU，可能导致主线程卡死。
- `SourceList` 如果包含很多 source（数千条）会一次性渲染大量 DOM，浏览器会崩。
- 输入框在中文输入法（IME）状态时按 Enter 会被误判为发送请求，导致请求在候选未确认前被触发。

**解决（已实现）**：
- `AnswerCard` 会在字符数超过约 12k 时，**自动启用 Web Worker 进行 diff 计算**；超大时仍会跳过 diff 并给出提示，避免 UI 卡死。
  - 相关文件：`src/workers/diffWorker.ts`、`src/features/rag/components/AnswerCard.tsx`
- `SourceList` 已改为基于 `@tanstack/react-virtual` 的**虚拟滚动**，并对 `sources` 做安全校验（防止非数组/异常）。
  - 额外加了“展示前 N 条”限制（默认 500 条），避免 DOM 爆炸。
  - 相关文件：`src/features/rag/components/SourceList.tsx`
- 输入框按 Enter 时会判断 IME 是否正在组合中（`compositionstart`/`compositionend`），只有**不在组合态**时才允许 Enter 触发发送。
  - 相关文件：`src/features/rag/components/AskRepoPanel.tsx`


## 10. Web Worker postMessage 缺少数据结构验证（安全提示）

**现象**：CodeQL 报告 `postMessage` 处理器缺少 origin/数据结构校验，建议防御可疑消息。

**解决（已实现）**：
- `src/workers/diffWorker.ts` 增加 `isDiffMessage` 类型保护函数，仅处理 `{ previous: string; current: string }`。
- 如果消息形态不匹配，直接 `return`。
- 确保未引入外部依赖、兼容 Worker 调用，且行为与外部无差异。

---

## 10. Stop → Retry 显示空红色错误框，不生成新回答

**现象：** 在流式生成回答时点击 **Stop**，再点击 **Retry**，界面出现空的红色错误框（无文字），不重新生成回答。浏览器控制台报：
```
Failed to load resource: the server responded with /api/rag/resume a status of 404 ()
```

**原因（双重）：**

1. **Bug A — resume session 不存在时进入 error 状态而非重新请求**
   - `retry()` 只要 `requestIdRef.current` 有值就走 resume 路径（`/api/rag/resume`）
   - `resume.ts` 调用 `getStreamSession(requestId)`；如果 Redis 中 session 已过期、被清理或冷启动未找到，返回 404
   - `performResume` 的 catch 仅识别 `network/timeout/abort` 类错误为可重试，404 不在范围内 → 直接 `setStreamStatus('error')`
   - 用户停掉的 stream 既没有成功，又卡在 error 状态，无法继续

2. **Bug B — 错误框显示空内容**
   - `AskRepoPanel` 的错误框条件是 `ask.isError`（`= mutation.isError || streamStatus === 'error'`）
   - 但显示的文字是 `ask.error?.message`（= `mutation.error.message`，来自 TanStack mutation）
   - resume 失败设的是 `setStreamError(message)`，不是 mutation error → `ask.error` 为 null → 渲染空框

**解决：**

**`src/features/rag/hooks/useAskRepo.ts`** — `performResume` catch 增加 `sessionGone` 判断：
```ts
const sessionGone = /session not found|not found or expired/i.test(message);
if (sessionGone) {
  requestIdRef.current = null;
  setStreamError(null);
  mutation.mutate(mutation.variables!); // fall back to fresh ask
} else if (retryable && ...) {
  ...
} else {
  setStreamError(message);
  setStreamStatus('error');
}
```

**`src/features/rag/components/AskRepoPanel.tsx`** — 修复错误框条件与内容：
```tsx
{ask.isError && (ask.streamError || ask.error?.message) && (
  <div className="rounded-xl border border-accent-red/30 bg-accent-red/5 p-4">
    <p className="text-sm text-accent-red">{ask.streamError ?? ask.error?.message}</p>
  </div>
)}
```

**涉及文件：**
- `src/features/rag/hooks/useAskRepo.ts`（`performResume` catch block）
- `src/features/rag/components/AskRepoPanel.tsx`（error box 条件与显示）

---


- 如果未来需要进一步加固：
  - 可在 `AnswerCard` 做”前 2k 字符先渲染、剩余按需加载”，避免一次性生成超长节点。
  - 可把 `SourceList` 的数据源改为后端分页或按需拉取，减少前端数据量。

---

## 11. Issues & Pull Requests 图表加载慢（~13 秒）

**现象：** Dashboard 上其他图表（Languages、Contributors、Commits）秒级加载完成，但 “Issues & Pull Requests” 图表需要约 13 秒才能显示数据。

**根本原因：GitHub Search API 速率限制导致的批次延迟**

`getMonthlyIssuePrCounts`（`src/api/github.ts`）需要查询 **12 个月 × 2 类（Issue + PR）= 24 次** API 调用，使用的是 GitHub `/search/issues` 端点。

该端点的速率限制为：
- 认证用户：30 次/分钟
- 未认证用户：10 次/分钟

为避免触发限流，代码采用**批次请求 + 强制延迟**策略：

```ts
// 每批处理 2 个月（4 个请求），批次之间强制等待 2500ms
const batchSize = 2;
for (let i = 0; i < monthRanges.length; i += batchSize) {
  if (i > 0) await new Promise((r) => setTimeout(r, 2500));
  // 并发执行本批次 4 个请求...
}
```

**时间开销分解（12 个月）：**
- 6 批次，批次间有 5 次 2500ms 延迟 = **12.5 秒**（纯延迟）
- 加上每批次的网络请求时间
- **总计约 13-15 秒**

**为什么其他图表快？**

其他图表使用专用 REST 端点，一次请求即可返回完整数据：
- Languages：`/repos/:owner/:repo/languages`（1 次请求）
- Contributors：`/repos/:owner/:repo/stats/contributors`（1 次请求）
- Commits：`/repos/:owner/:repo/stats/commit_activity`（1 次请求）

Issues/PRs 没有”按月统计”的现成端点，只能逐月调用 Search API。

**这是设计上的权衡，不是 bug。** 去掉延迟会导致大量 429 Rate Limit 错误。

**潜在优化方向（未实施）：**
1. **缩短时间跨度**：改为 6 个月而非 12 个月，延迟减半（约 6 秒）
2. **增大批次**：认证用户理论上可以把 batchSize 从 2 增加到 3（6 个请求/批），但余量很小，风险高
3. **渐进式更新**：每个批次完成后立即更新图表，而非等全部数据就绪——这需要修改 hook 返回流式数据，改动较大
4. **GitHub GraphQL API**：GraphQL 可以在一次请求里聚合多月数据，但需要重写数据层

**涉及文件：**
- `src/api/github.ts`（`getMonthlyIssuePrCounts`，第 166-208 行）
- `src/hooks/useIssues.ts`
