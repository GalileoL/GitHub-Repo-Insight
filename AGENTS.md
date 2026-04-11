# Unified AI Workflow

This repository requires a single, shared execution workflow for all AI coding agents.

## Mandatory End-Of-Task Checklist

Before marking any task as complete, every agent must do all of the following in order:

1. Run an independent code review using a separate reviewer agent when available.
2. Run tests (`npm test` or a narrower test command that still covers changed code).
3. Run lint (`npm run lint`).
4. Report review findings and test/lint results in the final response.

## Review Requirements

- The review must focus on correctness, regressions, edge cases, and missing tests.
- If a reviewer agent is unavailable in the runtime, perform a self-review pass and explicitly state that fallback.

## Failure Handling

- If review, test, or lint fails, do not claim completion.
- Either fix the issues and rerun the checklist, or clearly report what is blocked and why.

## Scope

- This file is the source of truth for workflow behavior.
- Any agent-specific instruction file must remain consistent with this checklist.