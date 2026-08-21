# AI Workflow

AI Workflow coordinates an autonomous development loop while retaining deterministic CI and human merge control:

`Task → Antigravity → Code/Test/PR → CI → ChatGPT Review → Fix/Re-review → Clean-room Review → Human Merge`

The project uses GitHub Pull Requests as the source of truth. ChatGPT receives a bounded project overview, current progress and the immutable PR handoff. Browser mode reuses one persisted ChatGPT conversation per project for normal reviews; clean-room final review should use a separate conversation.

## Review a live pull request

Start the persistent browser agent against an authenticated ChatGPT tab in Chrome Profile 2:

```bash
npm run browser:agent
```

Then review a real PR from another terminal:

```bash
npm run review:pr -- --pr 12
```

By default, context comes from `README.md` and `PROJECT_PROGRESS.md`. Override it when needed:

```bash
npm run review:pr -- --pr 12 \
  --project-id owner/repository \
  --overview-file docs/overview.md \
  --progress-file docs/progress.md
```

The browser agent stores the project-to-conversation mapping in `.ai/project-conversations.json`. Set `CHATGPT_CONVERSATION_STORE` to use another local path.
When Chrome exposes multiple ChatGPT accounts, set `CHATGPT_ACCOUNT_HINT` to an account name or email visible in the ChatGPT UI so the agent cannot select another profile accidentally.
If a long-running project thread becomes too large or its Chrome tab crashes, roll over the active mapping without deleting history:

```bash
npm run review:pr -- --pr 12 --new-conversation
```

See `PROJECT_PLAN.md` for architecture and implementation roadmap.

## Run the complete workflow with Antigravity

Create a task contract (see `.agents/skills/ai-workflow-runner/references/task-contract.md`) in the target repository, then run:

```bash
npm run workflow -- run \
  --repo /absolute/path/to/target-repository \
  --task .ai/task.json \
  --antigravity-auto-approve
```

The command is resumable and coordinates:

`branch → Antigravity code/check/commit → push → create/reuse PR → wait CI → ChatGPT review/comment → Antigravity fix → re-review → clean-room review → HUMAN_APPROVAL`

It never merges automatically. The default branch is `codex/<task-id>`, state is stored at `.ai/runs/<task-id>/state.json`, normal reviews reuse the project conversation, and every clean-room review starts a fresh conversation under `<project-id>:clean-room`.

Antigravity can invoke the workspace skill `ai-workflow-runner`, or call its runner directly from the target repository:

```bash
/absolute/path/to/ai_workflow/.agents/skills/ai-workflow-runner/scripts/run-workflow.sh \
  --task .ai/task.json \
  --antigravity-auto-approve
```

The runner starts the persistent browser reviewer when `REVIEWER_TRANSPORT=browser` and its health endpoint is unavailable. Use `REVIEWER_TRANSPORT=openai` with `OPENAI_API_KEY` to use the API transport instead.
