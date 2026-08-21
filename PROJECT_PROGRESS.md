# Project Progress

## Current baseline

- TypeScript build, state machine and persistent workflow state are implemented.
- GitHub adapter reads repository metadata, Pull Request details, diff and CI status through `gh`.
- ChatGPT reviewer supports browser/CDP and OpenAI API transports.
- Browser mode attaches to the existing authenticated Chrome Profile 2 session through a persistent local agent.
- Review loop supports blocking P0/P1 issues, fix/re-review, clean-room final review and human merge approval.
- Approval evidence is bound to the reviewed base SHA, head SHA, diff and successful CI state.
- Scope guards, action journal, run lease, branch strategy, review budgets and technical-debt gates are covered by tests.

## This pull request

- Adds a CLI for reviewing a real GitHub Pull Request.
- Includes bounded project overview and progress in each ChatGPT review request.
- Reuses one ChatGPT conversation per project and persists its conversation ID locally.
- Keeps clean-room review isolation as a separate conversation-level concern.
- Adds the workspace Antigravity skill `ai-workflow-runner` and its deterministic runner script.
- Adds a production `agy --print` Antigravity transport with structured output and git-derived commit evidence.
- Adds the resumable top-level workflow CLI for branch, coding, checks, push, PR creation, CI polling, ChatGPT review, fix/re-review and human handoff.
- Publishes idempotent normal and clean-room review comments to the PR.
- Uses a separate persistent ChatGPT conversation namespace for clean-room review.

## Remaining work

- Run a live clean-room validation against a disposable repository with real GitHub CI and a logged-in ChatGPT browser profile.
- Add multi-unit plan scheduling on top of the current one-task-per-PR execution contract.
