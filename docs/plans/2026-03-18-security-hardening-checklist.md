# Security Hardening Checklist (2026-03-18)

## Scope
- Branch: `fix/security-hardening-2026-03-18`
- Goal: Address security and robustness findings from CodeQL alerts and PR review comments.

## Change Summary

### 1) Fix nullable property access in GitHub API client
- File: `src/api/github.ts`
- Change:
  - Replaced direct `options.params` usage with a local `params` guard before `Object.entries(...)`.
- Why:
  - Prevents possible null/undefined property access warning and runtime risk.

### 2) Add minimal GitHub Actions token permissions
- File: `.github/workflows/ci.yml`
- Change:
  - Added:
    - `permissions:`
    - `contents: read`
- Why:
  - Satisfies CodeQL recommendation for explicit least-privilege workflow permissions.

### 3) Remove insecure default admin fallback
- File: `lib/rag/auth/index.ts`
- Change:
  - Removed default fallback admin username (`GalileoL`) when env var is absent.
  - `ADMIN_GITHUB_USERS` now defaults to empty string and filters empty values.
- Why:
  - Avoids accidental implicit admin access in misconfigured deployments.

### 4) Move ask-rate-limit check after request validation and index check
- File: `api/rag/ask.ts`
- Change:
  - Added `countRepoChunks(repo)` pre-check before retrieval.
  - Moved `checkRateLimit(...)` to run after body + format validation and after confirming indexed chunks exist.
- Why:
  - Avoids charging user quota for malformed requests or non-indexed repos.
  - Avoids unnecessary expensive retrieval when no chunks exist.

### 5) Harden SSE client against missing body / malformed data lines
- File: `src/features/rag/api/rag.ts`
- Change:
  - Added guard for `res.body` before `getReader()`.
  - Wrapped per-line SSE JSON parse in `try/catch`.
- Why:
  - Prevents client runtime crashes in environments where body streaming is unavailable.

### 6) Add explicit Ask status error state in UI
- File: `src/features/rag/components/AskRepoPanel.tsx`
- Change:
  - Added `status.isError` branch with error message and retry button.
- Why:
  - Prevents false “not indexed” impression when status endpoint fails.

### 7) Harden dashboard card-order localStorage handling
- File: `src/pages/DashboardPage.tsx`
- Change:
  - Added strict order validation helper (`isValidStoredOrder`).
  - Added guard in drag-end handler for `oldIndex/newIndex === -1`.
- Why:
  - Prevents broken reordering behavior from corrupted or stale localStorage values.

### 8) Cache repo chunk count in Redis
- Files:
  - `lib/rag/storage/index.ts`
  - `api/rag/ingest.ts`
- Change:
  - Added chunk-count cache helpers:
    - `getChunkCountKey(...)`
    - `setRepoChunkCount(...)`
    - cached read in `countRepoChunks(...)` with scan fallback + cache fill.
  - Updated ingest flow:
    - set cached count to `0` when no chunks.
    - set cached count to `chunks.length` after successful upsert.
  - `deleteRepoChunks(...)` now resets cached count to `0`.
- Why:
  - Reduces repeated full-vector scans for status/count checks.

### 9) Clarify local OAuth callback URL examples
- File: `.env.example`
- Change:
  - Updated callback comments to explicitly document:
    - `http://localhost:3000/auth/callback` for `vercel dev` / `pnpm dev:api`
    - `http://localhost:5173/auth/callback` for Vite dev server
- Why:
  - Reduces local OAuth misconfiguration risk.

### 10) Simplify Vercel SPA rewrite and exclude `/api/*`
- File: `vercel.json`
- Change:
  - Removed no-op rewrite `{ "source": "/api/(.*)", "destination": "/api/$1" }`.
  - Kept a single SPA fallback rewrite for non-API paths:
    - `{ "source": "/((?!api/).*)", "destination": "/index.html" }`
- Why:
  - Avoids self-rewrite confusion and keeps routing intent explicit.

### 11) Avoid non-numeric rate-limit headers for admin unlimited mode
- Files:
  - `api/rag/ask.ts`
  - `api/rag/ingest.ts`
- Change:
  - Header emission now checks `Number.isFinite(...)` before setting:
    - `X-RateLimit-Limit`
    - `X-RateLimit-Remaining`
- Why:
  - Prevents sending `Infinity` as header values, which can break strict clients/parsers.

### 12) Normalize login in Redis quota keys
- File: `lib/rag/auth/index.ts`
- Change:
  - Lowercase login before key creation for both ask and ingest counters.
  - Keys now use normalized login consistently.
- Why:
  - GitHub logins are case-insensitive; normalization prevents duplicate counters.

### 13) Improve quota concurrency behavior (INCR-first)
- File: `lib/rag/auth/index.ts`
- Change:
  - Replaced `GET -> compare -> INCR` flow with `INCR -> compare returned value`.
  - Set TTL when counter becomes `1`.
- Why:
  - Reduces race window under concurrent requests and makes limit enforcement more robust.

## Validation Results
- Lint: passed
- Type check (`pnpm exec tsc -b`): passed
- No editor errors in modified files after patching.

## Validation Results (After Screenshot Follow-up Fixes)
- Lint: passed
- Type check (`pnpm exec tsc -b`): passed

## Files Changed
- `.env.example`
- `.github/workflows/ci.yml`
- `api/rag/ask.ts`
- `api/rag/ingest.ts`
- `vercel.json`
- `lib/rag/auth/index.ts`
- `lib/rag/storage/index.ts`
- `src/api/github.ts`
- `src/features/rag/api/rag.ts`
- `src/features/rag/components/AskRepoPanel.tsx`
- `src/pages/DashboardPage.tsx`

## Review Checklist
- [ ] Confirm `ADMIN_GITHUB_USERS` is explicitly set in production if admin bypass is needed.
- [ ] Confirm new rate-limit ordering matches product expectation.
- [ ] Confirm Redis credentials exist in all environments where chunk-count cache is expected.
- [ ] Confirm CI workflow permissions policy aligns with org standards.
- [ ] Confirm OAuth callback URL setup for local and production apps.

## Notes
- This document is for review and verification before final commit/PR.
- Additional changes can be appended in a follow-up section once new requests arrive.
