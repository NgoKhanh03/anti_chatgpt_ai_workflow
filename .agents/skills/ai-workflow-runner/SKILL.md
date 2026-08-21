---
name: ai-workflow-runner
description: Executes an approved implementation plan through Antigravity coding, deterministic checks, commits, push, pull request creation, CI waiting, ChatGPT review, automatic blocking-issue fixes, and human-approval handoff. Use when the user asks Antigravity to implement or resume a plan through the full PR review loop.
---

# AI Workflow Runner

Use this skill only after the user has approved the implementation plan and authorized the repository mutations required by the plan.

## Run

1. Confirm the target repository and preserve unrelated local changes. The runner intentionally refuses to start a new branch when the worktree is dirty.
2. Normalize the approved plan into the task contract described in [references/task-contract.md](references/task-contract.md). Save it inside the target repository, normally as `.ai/task.json`.
3. Run [scripts/run-workflow.sh](scripts/run-workflow.sh) from the target repository:

   ```bash
   /absolute/path/to/ai_workflow/.agents/skills/ai-workflow-runner/scripts/run-workflow.sh \
     --task .ai/task.json \
     --antigravity-auto-approve
   ```

   Pass `--branch`, `--base`, `--project-id`, `--overview-file`, or `--progress-file` only when the defaults are wrong. `--antigravity-auto-approve` is allowed only when the user explicitly requested unattended execution.
4. Do not manually duplicate push, PR, CI, review-comment, or reviewer calls. The workflow CLI owns those operations and is safe to resume with the same task file.
5. Stop when the CLI reports `HUMAN_APPROVAL`, `NEEDS_HUMAN`, or a concrete error. Never merge automatically.

## Resume and verify

- Re-run the same command to resume from `.ai/runs/<task-id>/state.json` after interruption.
- Use `npm run workflow -- status --repo <repo> --task <task-file>` from the ai-workflow repository to inspect persisted state.
- Report the PR URL, final state, checks performed, and any remaining human action.

The runner keeps a normal ChatGPT conversation per project and a separate clean-room namespace. It publishes idempotent PR comments keyed by phase, iteration, and reviewed head SHA.
