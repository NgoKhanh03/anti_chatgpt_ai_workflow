import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AntigravityAdapter } from '../dist/adapters/index.js';
import { ReviewLoopCoordinator, WorkflowCoordinator } from '../dist/orchestrator/index.js';
import { StateStore, createInitialState } from '../dist/state/index.js';

const task = {
  task: { id: 'FEAT-FULL', objective: 'Run full automation', acceptanceCriteria: ['Works'] },
  constraints: [],
  definitionOfDone: ['checks pass'],
};

function pullRequest() {
  return {
    number: 91,
    title: 'Full automation',
    url: 'https://github.com/acme/demo/pull/91',
    headRefName: 'codex/feat-full',
    baseRefName: 'main',
    headSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    baseSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    ciState: 'SUCCESS',
  };
}

class FakeGitHubAutomation {
  constructor() {
    this.prepared = [];
    this.pushes = [];
    this.comments = [];
    this.ciWaits = 0;
  }
  async prepareBranch(branch, base) { this.prepared.push({ branch, base }); }
  async pushBranch(branch) { this.pushes.push(branch); }
  async ensurePullRequest() { return pullRequest(); }
  async getPullRequest() { return pullRequest(); }
  async waitForCi() { this.ciWaits += 1; return pullRequest(); }
  async publishReviewComment(_number, input) { this.comments.push(input); return true; }
  async createHandoffPacket() {
    return {
      repository: { owner: 'acme', name: 'demo', defaultBranch: 'main' },
      pullRequest: pullRequest(),
      diff: { patch: 'diff', files: [{ path: 'src/app.ts', additions: 1, deletions: 0 }] },
      generatedAt: new Date().toISOString(),
    };
  }
}

class CodingTransport {
  constructor() { this.requests = []; }
  async execute(request) {
    this.requests.push(request);
    return {
      taskId: request.task.task.id,
      success: true,
      summary: request.mode === 'IMPLEMENT' ? 'implemented' : 'fixed',
      branch: 'codex/feat-full',
      commitSha: request.mode === 'IMPLEMENT' ? 'commit-1' : 'commit-2',
      changedFiles: ['src/app.ts'],
      checks: { lint: 'PASS', typecheck: 'PASS', tests: 'PASS', build: 'PASS' },
      errors: [],
    };
  }
}

class SequenceReviewer {
  constructor(results) { this.results = [...results]; this.contexts = []; }
  async review(_handoff, _markdown, context) {
    this.contexts.push(context);
    const result = this.results.shift();
    if (!result) throw new Error('No review configured');
    return result;
  }
}

test('top-level workflow implements, pushes, creates PR, fixes review, comments and reaches human gate', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ai-workflow-runner-'));
  try {
    const store = new StateStore(join(dir, 'state.json'));
    await store.save({ ...createInitialState(), taskId: task.task.id });
    const github = new FakeGitHubAutomation();
    const coding = new CodingTransport();
    const antigravity = new AntigravityAdapter(coding);
    const reviewer = new SequenceReviewer([
      { verdict: 'REQUEST_CHANGES', issues: [{ id: 'R001', severity: 'P1', problem: 'Bug' }] },
      { verdict: 'APPROVE', issues: [] },
    ]);
    const clean = new SequenceReviewer([{ verdict: 'APPROVE', issues: [] }]);
    const reviewLoop = new ReviewLoopCoordinator(
      github, reviewer, clean, antigravity, store,
      { maxIterations: 5, ciTimeoutMs: 100, ciPollIntervalMs: 1 },
    );
    const workflow = new WorkflowCoordinator(github, antigravity, reviewLoop, store);

    const result = await workflow.run({
      task,
      branch: 'codex/feat-full',
      baseBranch: 'main',
      reviewContext: {
        project: { projectId: 'acme/demo' },
        cleanRoomProject: { projectId: 'acme/demo:clean-room' },
      },
    });

    assert.equal(result.state, 'HUMAN_APPROVAL');
    assert.deepEqual(github.prepared, [{ branch: 'codex/feat-full', base: 'main' }]);
    assert.deepEqual(github.pushes, ['codex/feat-full', 'codex/feat-full']);
    assert.equal(github.ciWaits, 3);
    assert.deepEqual(github.comments.map((comment) => comment.phase), ['review', 'review', 'clean-room']);
    assert.deepEqual(coding.requests.map((request) => request.mode), ['IMPLEMENT', 'FIX']);
    assert.equal(reviewer.contexts[0].projectId, 'acme/demo');
    assert.equal(clean.contexts[0].projectId, 'acme/demo:clean-room');
    const saved = await store.load();
    assert.equal(saved.issues.R001.status, 'VERIFIED');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
