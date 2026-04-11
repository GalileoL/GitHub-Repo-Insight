# Unified AI Workflow

This repository requires a single, shared execution workflow for all AI coding agents.

## Mandatory End-Of-Task Checklist

Before marking any task as complete, every agent must do all of the following in order:

1. Classify change risk (`L0` to `L3`) and determine impacted scope.
2. Run code review with depth required by the risk level.
3. Run tests required by the risk level (`targeted` or `full`).
4. Run lint (`npm run lint`).
5. Report risk level, review findings, and test/lint results in the final response.

## Project Knowledge Sync

- For `L2`/`L3` changes, or for `L0`/`L1` changes that affect architecture, workflows, API contracts, testing layout, or deployment behavior, run a repository scan before finishing.
- After the scan, update project knowledge artifacts when needed:
	- `README.md` for user-facing architecture/workflow/runtime behavior changes.
	- `Memory.md` as the canonical in-repo long-form project memory.
	- Runtime repository memory files (for example, `/memories/repo/` when available in the agent environment) for concise, repository-scoped operational facts.
	- Keep runtime repository memory snapshots consistent with `Memory.md` (condensed operational view, not a conflicting source).
- If no updates are needed after the scan, explicitly state that in the final response.

## Risk Levels

- `L0` Docs-only and non-runtime text changes (e.g., markdown docs, comments only).
- `L1` Tooling/config/workflow changes (e.g., CI, lint, test config, scripts) without runtime logic changes.
- `L2` Regular application/runtime code changes in a limited scope (single feature area and <= 3 directly impacted modules).
- `L3` High-risk changes: auth/security, data/storage, shared contracts/API behavior, or broad refactors.

## Review Policy

- `L0`: No separate reviewer agent required; do focused self-review on changed files.
- `L1`: Use separate reviewer agent with review limited to changed files.
- `L2`: Use separate reviewer agent; review changed files plus directly impacted modules.
- `L3`: Use separate reviewer agent with deep review on changed files, impacted modules, and regression risks.
- If a reviewer agent is unavailable in the runtime, perform a self-review pass and explicitly state that fallback.

## Impact Scope Heuristics

- Use this sequence: (1) start from changed files and classify a preliminary risk, (2) expand scope, (3) adjust risk if needed.
- Expand scope by direct imports/exports and touched public interfaces.
- "Directly impacted modules" means first-order modules that import changed symbols, are imported by changed public modules, or share modified contracts/types.
- Prefer targeted scope review over full-repo review unless risk is `L3`.
- If dependency impact cannot be determined reliably, escalate one level (e.g., `L1` -> `L2`, `L2` -> `L3`).

## Test Policy

- `L0`: Run targeted tests only when docs tooling is affected; otherwise tests may be skipped with explicit note. For behavior-affecting docs (e.g., API contract docs, configuration docs consumed by automation), include justification if tests are skipped.
- `L1`: Run targeted tests covering changed config behavior.
- `L2`: Run targeted tests covering changed code paths.
- `L3`: Run full `npm test` (or targeted + justification when full run is infeasible).

`Targeted tests` means the smallest test set that exercises changed files and their directly impacted modules.
`Docs tooling` means generators/validators/build steps for docs (for example markdown linting, docs-site build, or schema checks for docs-driven content).

## Review Requirements

- The review must focus on correctness, regressions, edge cases, and missing tests.
- For targeted review, findings must still include concrete file-level evidence.

## Failure Handling

- If review, test, or lint fails, do not claim completion.
- Either fix the issues and rerun the checklist, or clearly report what is blocked and why.

## Scope

- This file is the source of truth for workflow behavior.
- Any agent-specific instruction file must remain consistent with this checklist.

## Branch And PR Workflow

- Never push directly to `main`.
- Commit changes on the current feature branch.
- Push the feature branch to `origin`.
- Open or update a PR from the feature branch to `main`.
- Wait for CI and verify success using this order:
	1) If branch CI is configured for the pushed branch, wait for branch CI.
	2) If branch CI is not configured, wait for PR checks on the feature-branch PR.
- If automation for PR/CI is unavailable in the runtime (for example, missing GitHub CLI auth), provide the exact commands or URL needed and report the blocker.