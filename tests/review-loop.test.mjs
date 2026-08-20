import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AntigravityAdapter } from '../dist/adapters/index.js';
import { ReviewLoopCoordinator } from '../dist/orchestrator/index.js';
import { StateStore } from '../dist/state/index.js';

const task = {
  task: {
    id: 'FEAT-005',
    objective: 'Review loop demo',
    acceptanceCriteria: ['Works'],
  },
  constraints: [],
  definitionOfDone: ['checks pass'],
};

function handoff() {
  return {
    repository: { owner: 'acme', name: 'demo', defaultBranch: 'main' },
    pullRequest: {
      number: 5,
      title: 'Demo',
      url: 'https://github.com/acme/demo/pull/5',
      headRefName: 'feat/demo',
      baseRefName: 'main',
      ciState: 'SUCCESS',
    },
    diff: { patch: 'diff', files: [] },
    generatedAt: new Date().toISOString(),
  };
}

class FakeGitHub {
  async createHandoffPacket() {
    return handoff();
  }
}

class SequenceReviewer {
  constructor(results) {
    this.results = [...results];
  }
  async review() {
    const next = this.results.shift();
    if (!next) throw new Error('No review result configured');
    return next;
  }
}

class PassingAntigravityTransport {
  async execute(request) {
    return {
      taskId: request.task.task.id,
      success: true,
      summary: 'fixed',
      commitSha: 'abc123',
      changedFiles: ['src/demo.ts'],
      checks: {
        lint: 'PASS',
        typecheck: 'PASS',
        tests: 'PASS',
        build: 'PASS',
      },
      errors: [],
    };
  }
}

async function createStore(initialState) {
  const dir = await mkdtemp(join(tmpdir(), 'ai-review-loop-'));
  const file = join(dir, 'state.json');
  const store = new StateStore(file);
  await store.save({
    state: initialState,
    iteration: 0,
    issues: {},
    updatedAt: new Date().toISOString(),
  });
  return { dir, store };
}

test('REQUEST_CHANGES -> FIXING -> TESTING -> re-review -> HUMAN_APPROVAL', async () => {
  const { dir, store } = await createStore('PR_CREATED');
  try {
    const reviewer = new SequenceReviewer([
      {
        verdict: 'REQUEST_CHANGES',
        issues: [{ id: 'R001', severity: 'P1', problem: 'Bug' }],
      },
      { verdict: 'APPROVE', issues: [] },
    ]);
    const clean = new SequenceReviewer([{ verdict: 'APPROVE', issues: [] }]);
    const coordinator = new ReviewLoopCoordinator(
      new FakeGitHub(),
      reviewer,
      clean,
      new AntigravityAdapter(new PassingAntigravityTransport()),
      store,
      { maxIterations: 5 },
    );

    const result = await coordinator.run(task, 5);
    assert.equal(result.state, 'HUMAN_APPROVAL');
    assert.equal(result.iteration, 2);

    const saved = await store.load();
    assert.equal(saved.issues.R001.status, 'VERIFIED');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('clean-room blocking issue sends workflow back to FIXING', async () => {
  const { dir, store } = await createStore('PR_CREATED');
  try {
    const reviewer = new SequenceReviewer([
      { verdict: 'APPROVE', issues: [] },
      { verdict: 'APPROVE', issues: [] },
    ]);
    const clean = new SequenceReviewer([
      {
        verdict: 'REQUEST_CHANGES',
        issues: [{ id: 'CR001', severity: 'P1', problem: 'Final regression' }],
      },
      { verdict: 'APPROVE', issues: [] },
    ]);
    const coordinator = new ReviewLoopCoordinator(
      new FakeGitHub(),
      reviewer,
      clean,
      new AntigravityAdapter(new PassingAntigravityTransport()),
      store,
      { maxIterations: 5 },
    );

    const result = await coordinator.run(task, 5);
    assert.equal(result.state, 'HUMAN_APPROVAL');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('max iterations moves workflow to NEEDS_HUMAN', async () => {
  const { dir, store } = await createStore('PR_CREATED');
  try {
    const repeated = Array.from({ length: 3 }, (_, index) => ({
      verdict: 'REQUEST_CHANGES',
      issues: [{ id: `R${index}`, severity: 'P1', problem: 'Still broken' }],
    }));
    const coordinator = new ReviewLoopCoordinator(
      new FakeGitHub(),
      new SequenceReviewer(repeated),
      new SequenceReviewer([]),
      new AntigravityAdapter(new PassingAntigravityTransport()),
      store,
      { maxIterations: 3 },
    );

    const result = await coordinator.run(task, 5);
    assert.equal(result.state, 'NEEDS_HUMAN');
    assert.equal(result.iteration, 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('human approval is required before MERGED', async () => {
  const { dir, store } = await createStore('HUMAN_APPROVAL');
  try {
    const coordinator = new ReviewLoopCoordinator(
      new FakeGitHub(),
      new SequenceReviewer([]),
      new SequenceReviewer([]),
      new AntigravityAdapter(new PassingAntigravityTransport()),
      store,
      { maxIterations: 5 },
    );

    const merged = await coordinator.approveMerge();
    assert.equal(merged.state, 'MERGED');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
