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

**回退**：`RAG_EMBED_CONCURRENCY=1` 退化为串行行为，无需 revert 代码。

---

## 8. Open Questions
- [ ] 是否要在 batch 维度做 token 估算预校验（避免 400）？建议 Phase 2，结合 tiktoken 引入决策。
- [ ] 是否需要全局跨请求的 embedding 队列（多个 ingest 同时跑时共享 RPM 配额）？serverless 场景下意义不大，暂不做。
