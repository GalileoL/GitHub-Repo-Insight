# RAG 增量索引（Incremental Indexing）实施 Spec

> 日期：2026-05-14
> 分支：`feature/rag-indexing-optimization-spec`
> 状态：Draft — 待评审
> 关联：`docs/plans/2026-04-17-code-summary-on-demand-implementation-checklist.md`（Phase 1 全量索引基线）

---

## 1. 目标与非目标

### 1.1 目标
- 同一仓库二次 ingest 时，只重嵌「内容真正变化」的源码文件，跳过未变文件的 OpenAI embedding 调用与 Upstash upsert。
- 在稳定仓（commit 之间改动 <5% 文件）上把 ingest 端到端耗时降低 ≥ 50%，OpenAI embedding 成本下降同量级。
- 复用已有的 `ChunkMetadata.lastIndexedSha`（`lib/rag/types.ts:24`）与 `commitSha`（`types.ts:16`），不改 chunk ID 格式。

### 1.2 非目标
- 不处理非 code_summary 类型（commits、PR、issue chunk 不在本 spec 范围）。Phase 2 可独立扩展。
- 不引入文件级别 LLM 摘要缓存（独立议题）。
- 不切换向量库；继续使用 Upstash Vector。

---

## 2. 当前基线回顾

- `lib/rag/embeddings/index.ts:22` — `embedTexts()` 顺序 batch 调用。
- `lib/rag/storage/index.ts:52` — `upsertChunks()` 100/批 upsert，无 diff。
- `lib/rag/chunking/code-summary.ts:432` — `buildCodeSummaryChunks()` 每次全量重建 chunk。
- 现状：ingest 路径每次都先 `delete prefix={repo}:code:` 再全量重新 upsert（参见 storage range/delete 调用点）。

每次 ingest 的 embedding 调用次数 = `ceil(N_files / 512)`，无论文件是否变化。

---

## 3. 方案

### 3.1 核心思想
用 GitHub blob SHA 作为「文件内容指纹」，与已存 Upstash metadata 中的 `lastIndexedSha` 对比；只对差异集执行 embedding + upsert，其余文件原样保留。

### 3.2 数据模型变更
**无需新表/新字段。** 已有：
- `ChunkMetadata.lastIndexedSha`: 文件 blob SHA（GitHub tree 接口返回，非 commit SHA）
- `ChunkMetadata.commitSha`: 仓库级 commit SHA（保留，用于 UI 展示）

新增：
- `ChunkMetadata.indexedAt: number`（可选）— Unix 毫秒时间戳，用于 LRU/过期清理。
- `ChunkMetadata.chunkerVersion: string` — 切分逻辑版本号（例：`"code-summary@2"`）。与 `schemaVersion` 解耦：前者标识切分逻辑迭代（query 改进、AST 提取调整），后者标识 metadata 结构变化。任一不匹配都触发对应文件的重索引。

### 3.3 流程

```
ingest(repo, commitSha):
  1. fetchRepoTree(repo) → files[] { path, blobSha, size }
  2. candidates = files.filter(shouldIndexFile)  // 已有逻辑
  3. existing = fetchCodeSummaryIndex(repo)      // 新增：仅拉 metadata，不拉 vector
       → Map<filePath, { blobSha, chunkId }>
  4. diff:
       toAdd     = candidates where existing[path]?.blobSha !== file.blobSha
       toDelete  = existing keys not in candidates (文件被删/移出白名单)
       toKeep    = others
  5. fetch file contents only for toAdd (10/批，已有)
  6. buildCodeSummaryChunks(toAdd) → chunks
  7. embedTexts(chunks.map(c => c.content))      // 见 parallel-embedding spec
  8. upsertChunks(chunks)                        // ⚠️ 必须先写：宁可临时重叠也不能丢
  9. deleteChunksByIds(toDelete.map(e => e.chunkId))  // upsert 成功后才执行
  10. metrics.emit({ added, kept, deleted, total })

**写入顺序约束（P0）**：upsert 必须先于 delete。若中间崩溃，索引最多出现「旧 chunk + 新 chunk 重叠」状态（下次 ingest 自然收敛），永远不会出现「旧已删、新未写」的召回空洞。
```

### 3.4 关键 API 新增

`lib/rag/storage/index.ts`:
```ts
/** 返回 repo 已索引的 code_summary 文件清单，仅 metadata，不消耗向量查询配额 */
export async function fetchCodeSummaryIndex(
  repo: string,
): Promise<Map<string, { blobSha: string; chunkId: string; indexedAt?: number }>>
```

实现细节：
- 复用 `range({ prefix: '${repo}:code:', includeMetadata: true, includeVectors: false })`。
- 分页（默认 1000/页）直至 `nextCursor` 为空。
- 错误：返回空 Map 触发 fallback 全量索引（带 warn 日志）。

`lib/rag/storage/index.ts`:
```ts
export async function deleteChunksByIds(ids: string[]): Promise<void>
```

### 3.5 入口改动
- 改 `lib/rag/ingest/code-summary.ts`（或对应 orchestrator）：
  - 接收新参数 `mode: 'full' | 'incremental'`，默认 `incremental`。
  - 全量模式仍走旧路径（首次索引、metadata schema 升级时使用）。

### 3.6 触发重索引的条件

**全量重建（整仓）**：
1. 显式 `mode=full`。
2. `fetchCodeSummaryIndex` 返回为空（首次索引）。
3. metadata `schemaVersion` 提升（结构升级）。
4. ENV 开关 `RAG_FORCE_FULL_REINDEX=1`。

**单文件重索引**（落入 `toAdd`）：
- `blobSha` 变化（内容修改）。
- `chunkerVersion` 与当前不匹配（切分逻辑升级）。
- `lastIndexedSha` 缺失（早期 chunk 回填）。

---

## 4. 边界与一致性

| 场景 | 处理 |
|---|---|
| 文件 rename（旧路径删、新路径加） | 自动落入 toDelete + toAdd，无特殊处理 |
| 文件大小跨越 100KB 阈值变化 | candidates 过滤后会自动 toDelete |
| GitHub tree API 抖动返回部分文件 | 不允许 toDelete 数量超过 `max(20%, 10)`；超过则 abort 并回退全量 |
| Upstash range 中途失败 | catch → 走全量路径，metrics 标 `fallback_reason='index_scan_failed'` |
| blobSha 缺失（理论不应发生） | 视为 toAdd，强制重嵌 |
| 同 commit 重复 ingest | toAdd=0、toDelete=0，整体 no-op（节省 100% 嵌入费用） |

### 4.1 安全护栏：避免「灾难性 delete」与超大仓 OOM
新增配置：
```ts
const MAX_DELETE_RATIO = 0.2;     // 单次 ingest 最多删除 20% 已有 chunk
const MAX_DELETE_ABSOLUTE = 10;   // 或绝对数 10，取较大者
const HARD_LIMIT_CHUNKS = 50_000; // 单仓 chunk 数硬上限
```
- **删除护栏**：超过阈值时 log error、跳过 delete、保留旧 chunk，toAdd 仍照常写入（临时重叠，下次 ingest 自然收敛）。
- **chunk 数护栏**：`fetchCodeSummaryIndex` 累计扫到 `> HARD_LIMIT_CHUNKS` 时立即 abort 分页，强制 fallback 到全量路径（带显式告警 `fallback_reason='chunk_limit_exceeded'`），防止 ingest 函数 OOM 或超时。

---

## 5. 监控与可观测

`lib/rag/eval/`（已有 eval 事件机制）新增事件：
```ts
{
  event: 'ingest_diff',
  repo,
  commitSha,
  filesTotal,
  filesAdded,
  filesKept,
  filesDeleted,
  embedCallCount,        // 实际调用次数
  embedTokensEstimate,
  durationMs,
  fallbackReason?: string,
}
```

Admin report 新增 KPI：
- 每仓库平均 `filesAdded/filesTotal` 比例（健康值 < 0.1）
- 每周节省的 embedding tokens 估算

---

## 6. 测试计划

### 6.1 单测（`test/unit/lib/rag/`）
- `fetchCodeSummaryIndex`：mock `range`，分页正确合并、空仓返回空 Map、错误返回空 Map。
- diff 计算：4 个分支 toAdd/toDelete/toKeep/rename，每个独立用例。
- 安全护栏：删除 50% 文件时 abort。
- blobSha 缺失走 toAdd。

### 6.2 集成测试
- 用一个 mock repo 跑两轮 ingest：第二轮 toAdd=0，验证 `embedTexts` 未被调用。
- 修改 1 个文件再 ingest：验证只有该文件被 upsert，其他 chunk 完整保留（用 `range` 验证 metadata 未变）。
- ENV `RAG_FORCE_FULL_REINDEX=1` 时回到全量路径。

### 6.3 真实 smoke
本仓库自身 ingest 两次：首次记录 baseline 耗时与 token，第二次应当 `filesAdded ≤ 2`（仅 README/此 spec 变化的文件不在 src/lib/api 白名单内），ingest 时间 < 30s。

---

## 7. 阶段化交付

| Phase | 内容 | 验收 |
|---|---|---|
| P1 | `fetchCodeSummaryIndex` + 单测 | range 分页正确，metadata 完整 |
| P2 | diff 计算与安全护栏 | 全部单测绿 |
| P3 | ingest orchestrator 接入 `mode='incremental'` | smoke：二次 ingest 0 embedding |
| P4 | eval 事件 + admin report KPI | 报表展示新指标 |
| P5 | 文档：README ingest 章节 + AGENTS.md note | — |

预估工作量：1.5–2 人日（不含 review）。

---

## 8. 风险与回退

| 风险 | 缓解 |
|---|---|
| Upstash `range` 分页大仓性能差 | 加 cap（如 10k chunk），超出走全量；监控耗时 |
| blobSha 与 file content 不一致（GitHub 历史 bug） | 用 content hash 作二级校验（可选 Phase 2） |
| 已有数据缺 `lastIndexedSha`（早期 chunk） | 首次跑全量回填一次，之后稳态运行 |

---

## 10. Review Comments & Suggestions (Gemini CLI)

> 评审日期：2026-05-14。状态标记：✅ 已落地 / 📌 延后 / ❌ 驳回。

### 10.1 版本控制增强 ✅ 已落地（§3.2 / §3.6）
建议在 `ChunkMetadata` 中预留 `chunkerVersion: string` 字段。
- **理由**：`schemaVersion` 仅代表数据结构变化，而 `chunkerVersion` 代表切分逻辑变化。
- **处理**：新增 `chunkerVersion` 字段，并将其与 blobSha 一起列入「触发单文件重索引」的判定条件。

### 10.2 Rename 优化路径 📌 延后到 Phase 2
当前方案将 Rename 视为 `delete + add`。
- **观察**：如果 blobSha 未变但路径变了，技术上可以只执行 `update_metadata`。
- **处理**：Phase 1 维持 delete+add（安全性高、实现简单）；Phase 2 可识别 `oldPath.blobSha === newPath.blobSha` 转为更新操作。

### 10.3 Paging 性能与限制 ✅ 已落地（§4.1）
- **风险**：大仓产生 chunk 数量可能达 20k-40k。
- **处理**：新增 `HARD_LIMIT_CHUNKS = 50000`，超出立即 abort 分页并 fallback 全量，带显式告警。

### 10.4 状态同步一致性 ✅ 已落地（§3.3，P0）
- **建议**：upsert 先于 delete，宁可召回重复，不可彻底丢失。
- **处理**：流程图明确写入顺序约束，崩溃中态最多重叠，永远不会出现召回空洞。
