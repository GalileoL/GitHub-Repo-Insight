# Engineering Summary: Code RAG Enhancement & Production Monitoring System

This document summarizes the technical implementation of the source code indexing, on-demand fetching, and the distributed monitoring system completed between Phase 1 and Phase 8.

## 1. Source Code RAG (The "Superpower")
We have successfully enabled the system to "read" and understand source code from GitHub repositories without exceeding the 1GB Upstash Vector storage limit.

### 1.1 Summary-Based Indexing
- **AST Extraction**: Uses the `TypeScript Compiler API` to extract exports, signatures, and JSDoc.
- **Language Support**: High-precision AST for TS/JS; regex-based fallback for Go, Python, Rust, Java, and Kotlin.
- **Cap Strategy**: Maximum of 200 code summaries per repo, prioritizing entry points (e.g., `api/`, `lib/`, `App.tsx`) and file size.
- **Storage Efficiency**: Summaries consume ~10-15% of the original code's vector space.

### 1.2 On-Demand Code Fetching
- **Real-time Recovery**: When a query hits a `code_summary` chunk, the system fetches the actual source from GitHub API in real-time.
- **Symbol-Aware Windowing**: Instead of just grabbing the top of the file, the system locates the specific symbol (function/class) mentioned in the query and extracts a 150-line window (50 lines before, 100 after).
- **Resilience**: 2.5s per-file timeout and 3s total timeout. Falls back to summary-only answers if GitHub is slow or the file is >100KB.

---

## 2. Infrastructure & Performance
### 2.1 K1/K2 Isolation
- **Physical Isolation**: Implemented via Chunk-ID prefix scanning (`${repo}:code:`).
- **Retrieval Guard**: Both `vectorSearch` and `keywordSearch` are category-aware. Non-code queries explicitly exclude `code_summary` chunks at the database level to prevent documentation quality regression.

### 2.2 Evaluation Pipeline
- **Request Tracing**: Every request generates a `rag:eval:{requestId}` Hash in Redis.
- **Funnel Metrics**: Tracks `intent -> retrieval -> code_fetch -> answer -> feedback`.
- **Atomic Feedback**: The `/api/rag/feedback` endpoint uses multi-field atomic writes to prevent user signals from overwriting each other.

---

## 3. Operations & Monitoring (Phase 8)
### 3.1 Daily Reporting System
- **Secondary Indexing**: Uses Redis Sets (`rag:eval:index:{YYYY-MM-DD}`) for O(1) request lookups, avoiding expensive `SCAN` operations.
- **Vercel Cron**: A daily job at 01:00 UTC aggregates metrics and sends a Markdown-formatted email report.

### 3.2 Distributed Alerting Sub-system
- **Distributed State**: Uses Redis counters to track error streaks (e.g., 5 consecutive timeouts) across stateless Serverless instances.
- **Smart Suppression**: Implements a 1-hour suppression window per error type to prevent alert fatigue.
- **Notifier Abstraction**: Multi-channel support (Webhook -> Resend Email -> Structured Log).

---

## 4. Launch Checklist & Environment Variables
The following variables are **required** for the monitoring system to function in production:

| Variable | Purpose | Source |
|----------|---------|--------|
| `RESEND_API_KEY` | Sending daily reports & alerts | resend.com |
| `OPS_EMAIL_FROM` | Verified sender email | resend.com |
| `OPS_EMAIL_TO` | Admin recipient email | Your inbox |
| `CRON_SECRET` | Securing the report endpoint | Random UUID |
| `OPS_WEBHOOK_URL` | Slack/Discord alerts (Optional) | Incoming Webhook |

---

## 5. Maintenance
- **TTL**: Evaluation data and indexes are kept for 48 hours.
- **Logs**: Search for `type: "rewrite_diagnostics"` or `type: "code_fetch"` in Vercel Logs for real-time debugging.
