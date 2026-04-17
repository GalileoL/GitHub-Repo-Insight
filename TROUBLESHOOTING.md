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

## 10. Stop → Retry 断流恢复现在使用 Redis checkpoint

**现状：** 旧的“resume 只靠 `lastSeq` 重新检索”的逻辑已经替换为 checkpoint 方案。当前会把 `partialAnswer + exact context snapshot + sources` 存到 Redis，`/api/rag/resume` 直接用这个快照继续生成，不再依赖重新跑检索流程。

**涉及文件：**
- `api/rag/ask.ts`
- `api/rag/resume.ts`
- `lib/rag/storage/index.ts`
- `lib/rag/llm/index.ts`
- `src/features/rag/hooks/useAskRepo.ts`

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

---

## 12. Rollup native binary 在本地测试/构建时报 `ERR_DLOPEN_FAILED`

**现象：**

- `pnpm install` 可以成功
- 但 `pnpm test` / `pnpm build` 在启动 Rollup 时失败
- 典型报错：

```txt
Error: Cannot find module @rollup/rollup-darwin-arm64
...
[cause]: Error: dlopen(.../rollup.darwin-arm64.node, 0x0001): ...
code signature ... not valid for use in process:
mapping process and mapped file (non-platform) have different Team IDs
```

**原因：**

- 这不是单纯的 `pnpm install` 失败，而是 **Rollup 的 macOS native `.node` 模块在当前运行环境里无法被加载**。
- 在本项目里，`vite` / `vitest` 会依赖 `rollup`，而默认的 `rollup` 包会尝试加载平台对应的 native binary（如 `@rollup/rollup-darwin-arm64`）。
- 在桌面代理/受限运行环境下，这类 native binary 可能因为 code signature / library validation 被拒绝加载。
- 额外补充：
  - 单独去掉 `xattr`
  - 或重新 `codesign`
  - 或 `pnpm rebuild rollup`
  在这个场景下都**不一定稳定生效**。

**排查过程：**

1. 先跑 `pnpm install`
   - 结果：安装成功，说明不是常规依赖缺失
2. 再跑 `pnpm test`
   - 结果：失败点落在 `node_modules/rollup/dist/native.js`
3. 检查 `.node` 文件本身
   - 发现 native binary 实际存在，但 `dlopen` 因签名/Team ID 校验失败
4. 尝试最小修复
   - 去掉 `xattr`
   - 重做 ad-hoc `codesign`
   - `pnpm rebuild rollup`
   - 结果：仍不稳定，不能作为仓库级可重复修复
5. 最终改为 **绕过 native binary**
   - 将项目顶层 `rollup` 显式切换到 `@rollup/wasm-node`

**最终解决方案：**

- 在 `package.json` 的 `devDependencies` 中使用：

```json
"rollup": "npm:@rollup/wasm-node@^4.59.0"
```

- 然后重新安装依赖：

```bash
pnpm install
```

- 验证：

```bash
pnpm ls rollup
pnpm test
pnpm build
```

**修复后的预期：**

- `pnpm ls rollup` 应显示类似：

```txt
rollup  npm:@rollup/wasm-node@4.60.1
```

- `pnpm test` 和 `pnpm build` 不再触发 `@rollup/rollup-darwin-arm64` 的 native load 错误

**为什么不用继续修本地签名？**

- 重新签名 `.node` 文件属于**环境级 workaround**
- 即使本机短暂生效，也不保证：
  - 其他机器可复现
  - 重新安装依赖后仍生效
  - Codex / 桌面代理 / CI 环境都一致
- 切到 `@rollup/wasm-node` 是**仓库内可重复、可提交、可跨环境共享**的修复

**涉及文件：**

- `package.json`
- `pnpm-lock.yaml`

---

## 13. Tailwind 4 / `@tailwindcss/oxide` 在本地构建时报 native binding 错误

**现象：**

- `pnpm install` 和 `pnpm test` 都能通过
- 但 `pnpm build` / `pnpm dev` 在加载 `@tailwindcss/vite` 时失败
- 典型报错：

```txt
Error: Cannot find native binding.
...
@tailwindcss/oxide-darwin-arm64/tailwindcss-oxide.darwin-arm64.node
code signature ... not valid for use in process
```

**原因：**

- `@tailwindcss/vite` 会间接加载 `@tailwindcss/oxide`。
- `@tailwindcss/oxide` 默认优先使用平台 native binding；在当前 macOS 受限运行环境里，这个 `.node` 文件同样可能因为 code signature / Team ID 校验失败而被拒绝加载。
- 在当前 `pnpm` 布局下，只要 `@tailwindcss/oxide-wasm32-wasi` 被显式安装到仓库依赖里，`@tailwindcss/oxide` 就能稳定回退到 WASI 实现。

**最终解决方案：**

1. 在 `devDependencies` 中显式添加：

```json
"@tailwindcss/oxide-wasm32-wasi": "4.2.2"
```

**验证：**

```bash
pnpm install
pnpm dev
pnpm build
```

**修复后的预期：**

- `pnpm dev` 和 `pnpm build` 可以正常启动 Tailwind / Vite
- 终端可能会看到 Node 的 `ExperimentalWarning: WASI is an experimental feature`
- 这个 warning 当前可以接受；它不会阻止开发、测试或构建完成

**涉及文件：**

- `package.json`
- `pnpm-lock.yaml`

**如果以后又遇到类似问题：**

优先按这个顺序处理：

1. 先确认是安装失败还是 `dlopen` 失败
2. 如果是 native `.node` 加载失败，优先考虑是否能切到 WASM 版依赖
3. 只有在必须使用 native binary 时，才再尝试本机签名/属性修复
