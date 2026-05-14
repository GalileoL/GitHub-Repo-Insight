# RAG 并行批量 Embedding 实施 Spec

> 日期：2026-05-14
> 分支：`feature/rag-indexing-optimization-spec`
> 状态：Draft — 待评审
> 关联文件：`lib/rag/embeddings/index.ts`

---

## 1. 目标与非目标

### 1.1 目标
- 把 `embedTexts()` 中的顺序 batch 循环改为并发执行，并合理设定批大小与并发上限。
- 在 ≥ 1000 文本输入下，端到端耗时降低 ≥ 40%。
- 加入重试、指数退避、429/5xx 区分处理；避免突发并发触发 OpenAI rate limit。

### 1.2 非目标
- 不切换 embedding 模型（仍 `text-embedding-3-small`）。
- 不实现 token 级 batching（当前按条数 batching 足够；可作 Phase 2）。
- 不引入流式 embedding（OpenAI 当前不支持）。

---

## 2. 当前基线

`lib/rag/embeddings/index.ts:22-41`：
```ts
const BATCH = 512;
for (let i = 0; i < texts.length; i += BATCH) {
  const batch = texts.slice(i, i + BATCH);
  const res = await client.embeddings.create({ ... });
  results.push(...);
}
```
- 顺序 `await`，无并发。
- 无重试、无超时控制。
- 1024 个文本 ≈ 2 batch，串行≈ 2 × p50；3000 文本 ≈ 6 batch，串行严重。

OpenAI `text-embedding-3-small` 单次上限：**2048 inputs / 300k tokens / 8191 token per input**。账户级 RPM/TPM 限制需结合实际配额（默认 tier-1 约 3000 RPM、1M TPM）。

---

## 3. 方案

### 3.1 关键决策
- **批大小**：保持 `BATCH = 512`（兼顾错误粒度与单次延迟；不顶满 2048 是为了 retry 时丢失更少）。
- **并发上限**：`MAX_CONCURRENCY = 4`，可由 ENV `RAG_EMBED_CONCURRENCY` 覆盖（范围 1–16）。
- **重试**：每个 batch 独立重试 3 次，指数退避 `min(2^n * 500ms, 8s)` + jitter。
- **错误分类**：
  - 429 / 5xx → 重试。
  - 400（input 超 token 上限等）→ 不重试，把违规 input 单独定位后抛 `EmbedError`。
  - timeout（默认每 batch 30s）→ 重试。

### 3.2 实现草图

```ts
const BATCH = 512;
const MAX_CONCURRENCY = Number(process.env.RAG_EMBED_CONCURRENCY ?? 4);
const PER_BATCH_TIMEOUT_MS = 30_000;

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const batches: { idx: number; inputs: string[] }[] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    batches.push({ idx: i, inputs: texts.slice(i, i + BATCH) });
  }

  const results = new Array<number[]>(texts.length);
  const pool = new ConcurrencyPool(MAX_CONCURRENCY);

  await Promise.all(
    batches.map((b) =>
      pool.run(() => embedOneBatchWithRetry(b.inputs, PER_BATCH_TIMEOUT_MS)).then((vecs) => {
        for (let j = 0; j < vecs.length; j++) results[b.idx + j] = vecs[j];
      }),
    ),
  );

  return results;
}
```

`ConcurrencyPool`：简单实现，不引入额外依赖（拒绝引入 `p-limit`，保持 zero-dep 风格）。

**关键不变式（P0）**：`activeCount` 必须在 `try/finally` 中归还，无论 job 成功、抛错、还是被外部 abort。否则一个未捕获异常会让 slot 永久泄露，整条 ingest 流水卡死。最小实现示意：
```ts
async run<T>(job: () => Promise<T>): Promise<T> {
  await this.acquire();          // 等到有空 slot
  try {
    return await job();
  } finally {
    this.release();              // 必须放在 finally
  }
}
```
单测必须覆盖：连续 N 个 job 抛错，pool 仍能接受新 job 并清零 `activeCount`。

**输入预切分（P1，9.1）**：在压入 pool 之前，对每个 batch 用 `char/4` 估算 token；若估算 > 6000 token，则按估算切成 2 份再入 pool。这是廉价的鲁棒性保险，不需要 tiktoken。tiktoken 精确校验留待 Phase 2。

`embedOneBatchWithRetry`：
```ts
async function embedOneBatchWithRetry(inputs: string[], timeoutMs: number): Promise<number[][]> {
  let attempt = 0;
  while (true) {
    try {
      return await withTimeout(callOpenAI(inputs), timeoutMs);
    } catch (err) {
      if (!isRetriable(err) || attempt >= 3) throw classify(err, inputs);
      const backoff = Math.min(500 * 2 ** attempt, 8000) + Math.random() * 300;
      await sleep(backoff);
      attempt++;
    }
  }
}
```

### 3.3 顺序保持
对调用方而言，返回 `number[][]` 必须严格按 `texts` 输入顺序。实现用 `idx + j` 写回固定数组槽位，杜绝乱序。

### 3.4 边界
| 输入 | 行为 |
|---|---|
| `texts.length === 0` | 返回 `[]` |
| 单个 batch | 不进 pool，直接 await |
| 任一 batch 最终失败 | 整个 `embedTexts` 抛错；不返回部分结果（避免静默丢向量） |
| 超长单条 input（> 8191 token） | OpenAI 返回 400 → `EmbedError` 携带该 input 在原数组的 index |

**`EmbedError` 形状（P1，9.4）**：
```ts
class EmbedError extends Error {
  readonly batchStartIndex: number;   // batch 在原 texts 数组的起始 index
  readonly batchEndIndex: number;     // 结束 index（不含）
  readonly offendingInputIndex?: number; // 若能定位到具体违规条，填这里
  readonly httpStatus?: number;
  readonly cause?: unknown;
}
```
Ingest orchestrator 收到 `EmbedError` 后可选择：a) 抛错整体失败；b) 在「容错模式」下跳过该 index 范围、记录到 eval 事件、继续索引其他文件。

---

## 4. 监控

新增 eval 事件 `embed_batch`：
```ts
{
  repo,
  batchCount,
  inputCount,
  concurrency,
  durationMs,
  retries: number,
  failedBatches: number,
}
```

并在 admin report 展示：
- 平均 embedding 耗时（每 100 文本归一化）
- retry 率（健康值 < 2%）
- 429 命中次数

---

## 5. 测试计划

### 5.1 单测
- `texts.length = 0` → `[]`
- `texts.length < BATCH` → 单批直发
- `texts.length = 1300` → 3 batch 并发，且返回顺序与输入一致（用 mock 故意延迟第一个 batch 验证）
- 429 重试：mock 前两次抛 429，第 3 次成功
- 400 不重试：mock 抛 400 → 立即 `EmbedError`
- 超时：mock 永不 resolve → 30s 触发重试 → 终态失败抛错

### 5.2 集成测试
配 `RAG_EMBED_CONCURRENCY=8`，跑本仓库 ingest，对比改造前后耗时。预期改造后 ≤ 60% 原耗时。

### 5.3 压力
单元测试不跑真 OpenAI；引入可选 `pnpm test:integration:embed`，用一个小型 repo（≈ 50 文件）作真实联调，验证 RPM 不被打爆。

---

## 6. 阶段化交付

| Phase | 内容 |
|---|---|
| P1 | `ConcurrencyPool` 工具 + 单测 |
| P2 | `embedOneBatchWithRetry` + 顺序保持 + 单测 |
| P3 | 替换 `embedTexts` 实现，跑本仓 smoke |
| P4 | eval 事件 + admin KPI |
| P5 | 文档：ENV `RAG_EMBED_CONCURRENCY` 说明 + 默认值理由 |

预估工作量：0.5–1 人日。

---

## 7. 风险与回退

| 风险 | 缓解 |
|---|---|
| 高并发触发 OpenAI 账户级 RPM 上限 | 默认 4 已远低于 tier-1 上限；429 自动退避 |
| 顺序错乱（结果数组与 input 偏移） | 显式按 `idx+j` 写回；单测覆盖 |
| ENV 配置异常（非数字/过大值） | `clamp(parsed, 1, 16)`，非法值 → 默认 4 + warn |

---

## 9. Review Comments & Suggestions (Gemini CLI)

> 评审日期：2026-05-14。状态标记：✅ 已落地 / 📌 延后 / ❌ 部分驳回。

### 9.1 Token 级预校验 ✅ 已落地（§3.2）
- **建议**：在压入 pool 前用 `char/4` 估算，预估 > 6000 token 自动拆分。
- **处理**：已写入实现示意；tiktoken 精确校验留待 Phase 2。

### 9.2 ConcurrencyPool 健壮性 ✅ 已落地（§3.2，P0）
- **建议**：activeCount 必须在异常时归零，否则卡死。
- **处理**：明确 `try/finally release()` 不变式，单测必须覆盖「连续抛错 + 后续 job 仍可接受」。

### 9.3 超时与退避的联动 ❌ 部分驳回
- **建议前半（采纳）**：429 时下次重试调大 `timeoutMs` —— 合理，写入退避逻辑即可（每次重试 `timeoutMs *= 1.5`，封顶 60s）。
- **建议后半（驳回）**：降权重 / 动态调整并发 —— 过度设计。固定 `MAX_CONCURRENCY=4` 已远低于 tier-1 RPM，429 走退避足够；引入权重池增加测试面与 bug 面。

### 9.4 异常上下文捕获 ✅ 已落地（§3.4）
- **建议**：`EmbedError` 必须携带 index 范围以支持容错模式。
- **处理**：明确 `EmbedError` 字段形状（`batchStartIndex` / `batchEndIndex` / `offendingInputIndex`），orchestrator 可选择 fail-fast 或 skip-and-continue。
