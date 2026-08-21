import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubClient, renderReviewComment } from '../dist/github/index.js';

function prJson(conclusion = 'SUCCESS') {
  return {
    number: 42,
    title: 'Automated PR',
    url: 'https://github.com/acme/demo/pull/42',
    headRefName: 'codex/feat',
    baseRefName: 'main',
    headRefOid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    baseRefOid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    statusCheckRollup: [{ conclusion }],
  };
}

class AutomationRunner {
  constructor() { this.calls = []; this.ci = ['PENDING', 'SUCCESS']; this.comments = []; }
  async run(command, args) {
    const joined = args.join(' ');
    this.calls.push(`${command} ${joined}`);
    if (command === 'gh' && joined === 'repo view --json owner,name,defaultBranchRef') {
      return { stdout: JSON.stringify({ owner: { login: 'acme' }, name: 'demo', defaultBranchRef: { name: 'main' } }), stderr: '' };
    }
    if (command === 'git' && joined.startsWith('push --set-upstream origin')) return { stdout: '', stderr: '' };
    if (command === 'gh' && joined.includes('pr list --head')) return { stdout: '[]', stderr: '' };
    if (command === 'gh' && joined.includes('pr create --head')) return { stdout: 'https://github.com/acme/demo/pull/42\n', stderr: '' };
    if (command === 'gh' && joined.startsWith('pr view 42 --json number,title')) {
      const conclusion = this.ci.shift() ?? 'SUCCESS';
      return { stdout: JSON.stringify(prJson(conclusion)), stderr: '' };
    }
    if (command === 'gh' && joined === 'pr view 42 --json comments -R acme/demo') {
      return { stdout: JSON.stringify({ comments: this.comments }), stderr: '' };
    }
    if (command === 'gh' && joined.startsWith('pr comment 42 --body')) {
      this.comments.push({ body: args[args.indexOf('--body') + 1] });
      return { stdout: '', stderr: '' };
    }
    throw new Error(`Unexpected command: ${command} ${joined}`);
  }
}

test('GitHub automation pushes, creates PR and polls CI to success', async () => {
  const runner = new AutomationRunner();
  let now = 0;
  const client = new GitHubClient(runner, '/tmp/repo', {
    now: () => now,
    sleep: async (milliseconds) => { now += milliseconds; },
  });
  await client.pushBranch('codex/feat');
  const pr = await client.ensurePullRequest({
    headBranch: 'codex/feat', baseBranch: 'main', title: 'Feature', body: 'Body',
  });
  assert.equal(pr.number, 42);

  runner.ci = ['PENDING', 'SUCCESS'];
  const ready = await client.waitForCi(42, { timeoutMs: 100, pollIntervalMs: 10 });
  assert.equal(ready.ciState, 'SUCCESS');
  assert.equal(now, 10);
  assert.ok(runner.calls.includes('git push --set-upstream origin codex/feat'));
});

test('review comments are idempotent for phase, iteration and head SHA', async () => {
  const runner = new AutomationRunner();
  const client = new GitHubClient(runner, '/tmp/repo');
  const input = {
    phase: 'review', iteration: 1, headSha: 'abc123', verdict: 'REQUEST_CHANGES',
    issues: [{ id: 'R1', severity: 'P1', problem: 'Bug', recommendedFix: 'Fix it' }],
  };
  assert.equal(await client.publishReviewComment(42, input), true);
  assert.equal(await client.publishReviewComment(42, input), false);
  assert.equal(runner.calls.filter((call) => call.startsWith('gh pr comment')).length, 1);
  assert.match(renderReviewComment(input), /Human approval is still required/);
});

test('branch preparation ignores workflow state under .ai but blocks unrelated changes', async () => {
  let status = '?? .ai/task.json\n?? .ai/runs/feat/state.json\n';
  const runner = {
    async run(command, args) {
      const joined = args.join(' ');
      if (command === 'git' && joined === 'status --porcelain --untracked-files=all') {
        return { stdout: status, stderr: '' };
      }
      if (command === 'git' && joined === 'branch --show-current') {
        return { stdout: 'main\n', stderr: '' };
      }
      if (command === 'git' && joined === 'branch --list codex/feat') {
        return { stdout: '', stderr: '' };
      }
      if (command === 'git' && joined === 'switch -c codex/feat main') {
        return { stdout: '', stderr: '' };
      }
      throw new Error(`Unexpected command: ${command} ${joined}`);
    },
  };
  const client = new GitHubClient(runner, '/tmp/repo');
  assert.equal(await client.prepareBranch('codex/feat', 'main'), 'codex/feat');

  status += '?? src/unrelated.ts\n';
  await assert.rejects(client.prepareBranch('codex/other', 'main'), /clean worktree/);
});
