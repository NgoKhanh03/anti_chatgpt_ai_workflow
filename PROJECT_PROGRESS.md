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

## Remaining work

- Wire a production coding-agent transport into the orchestrator.
- Add PR creation/update, CI polling and review-comment publishing.
- Add a top-level workflow CLI that coordinates coding, PR, review, fix and resume.
- Add a dedicated clean-room conversation namespace.
