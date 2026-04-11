# Copilot Workflow Rules

Use `AGENTS.md` as the canonical workflow.

Required completion checklist for every coding task:

1. Run an independent code review (separate reviewer agent when possible).
2. Run tests that cover changed code.
3. Run lint.
4. Summarize review plus test/lint outcomes.

Do not mark tasks complete if any checklist item fails.