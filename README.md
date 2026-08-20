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

See `PROJECT_PLAN.md` for architecture and implementation roadmap.
