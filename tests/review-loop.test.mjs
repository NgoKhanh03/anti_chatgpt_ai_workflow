import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AntigravityAdapter } from '../dist/adapters/index.js';
import { ReviewLoopCoordinator } from '../dist/orchestrator/index.js';
import { StateStore } from '../dist/state/index.js';
import { createApprovalEvidence } from '../dist/review/index.js';
import { CiWaitTimeoutError } from '../dist/github/index.js';

const task = {
  task: {
    id: 'FEAT-005',
    objective: 'Review loop demo',
    acceptanceCriteria: ['Works'],
  },
  constraints: [],
  definitionOfDone: ['checks pass'],
};

function handoff(ciState = 'SUCCESS') {
  return {
    repository: { owner: 'acme', name: 'demo', defaultBranch: 'main' },
    pullRequest: {
      number: 5,
      title: 'Demo',
      url: 'https://github.com/acme/demo/pull/5',
      headRefName: 'feat/demo',
      baseRefName: 'main',
      headSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      baseSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      ciState,
    },
    diff: { patch: 'diff', files: [] },
    generatedAt: new Date().toISOString(),
  };
}

class FakeGitHub {
  constructor(ciStates = ['SUCCESS']) {
    this.ciStates = [...ciStates];
  }

  async createHandoffPacket() {
    return handoff(this.ciStates.shift() ?? 'SUCCESS');
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

class FailingAntigravityTransport {
  async execute(request) {
    return {
      taskId: request.task.task.id,
      success: false,
      summary: 'fix failed',
      changedFiles: [],
      checks: {
        lint: 'PASS',
        typecheck: 'PASS',
        tests: 'FAIL',
        build: 'SKIPPED',
      },
      errors: ['tests failed'],
    };
  }
}

class MissingCommitAntigravityTransport {
  async execute(request) {
    return {
      taskId: request.task.task.id,
      success: true,
      summary: 'fixed without commit',
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

test('CI failure returns workflow to FIXING without invoking reviewer', async () => {
  const { dir, store } = await createStore('PR_CREATED');
  try {
    const coordinator = new ReviewLoopCoordinator(
      new FakeGitHub(['FAILURE']),
      new SequenceReviewer([]),
      new SequenceReviewer([]),
      new AntigravityAdapter(new PassingAntigravityTransport()),
      store,
      { maxIterations: 5 },
    );

    const result = await coordinator.run(task, 5);
    assert.equal(result.state, 'FIXING');
    assert.equal(result.iteration, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('pending CI pauses in AI_REVIEWING without invoking reviewer', async () => {
  const { dir, store } = await createStore('PR_CREATED');
  try {
    const coordinator = new ReviewLoopCoordinator(
      new FakeGitHub(['PENDING']),
      new SequenceReviewer([]),
      new SequenceReviewer([]),
      new AntigravityAdapter(new PassingAntigravityTransport()),
      store,
      { maxIterations: 5 },
    );

    const result = await coordinator.run(task, 5);
    assert.equal(result.state, 'AI_REVIEWING');
    assert.equal(result.iteration, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('CI polling timeout persists NEEDS_HUMAN', async () => {
  const { dir, store } = await createStore('PR_CREATED');
  try {
    const github = new FakeGitHub();
    github.waitForCi = async () => { throw new CiWaitTimeoutError(5, 10); };
    const coordinator = new ReviewLoopCoordinator(
      github,
      new SequenceReviewer([]),
      new SequenceReviewer([]),
      new AntigravityAdapter(new PassingAntigravityTransport()),
      store,
      { maxIterations: 5, ciTimeoutMs: 10, ciPollIntervalMs: 1 },
    );
    const result = await coordinator.run(task, 5);
    assert.equal(result.state, 'NEEDS_HUMAN');
    assert.equal((await store.load()).state, 'NEEDS_HUMAN');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('non-blocking REQUEST_CHANGES proceeds to clean-room review', async () => {
  const { dir, store } = await createStore('PR_CREATED');
  try {
    const coordinator = new ReviewLoopCoordinator(
      new FakeGitHub(),
      new SequenceReviewer([
        {
          verdict: 'REQUEST_CHANGES',
          issues: [{ id: 'R-P2', severity: 'P2', problem: 'Optional improvement' }],
        },
      ]),
      new SequenceReviewer([{ verdict: 'APPROVE', issues: [] }]),
      new AntigravityAdapter(new PassingAntigravityTransport()),
      store,
      { maxIterations: 5 },
    );

    const result = await coordinator.run(task, 5);
    assert.equal(result.state, 'HUMAN_APPROVAL');
    assert.equal(result.iteration, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('failed fix remains OPEN and returns workflow to FIXING', async () => {
  const { dir, store } = await createStore('PR_CREATED');
  try {
    const review = {
      verdict: 'REQUEST_CHANGES',
      issues: [{ id: 'R-FAIL', severity: 'P1', problem: 'Still broken' }],
    };
    const coordinator = new ReviewLoopCoordinator(
      new FakeGitHub(),
      new SequenceReviewer([review]),
      new SequenceReviewer([]),
      new AntigravityAdapter(new FailingAntigravityTransport()),
      store,
      { maxIterations: 5 },
    );

    const result = await coordinator.run(task, 5);
    const saved = await store.load();
    assert.equal(result.state, 'FIXING');
    assert.equal(saved.issues['R-FAIL'].status, 'OPEN');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('fix without a commit remains OPEN and returns workflow to FIXING', async () => {
  const { dir, store } = await createStore('PR_CREATED');
  try {
    const coordinator = new ReviewLoopCoordinator(
      new FakeGitHub(),
      new SequenceReviewer([
        {
          verdict: 'REQUEST_CHANGES',
          issues: [{ id: 'R-NO-COMMIT', severity: 'P1', problem: 'Must be committed' }],
        },
      ]),
      new SequenceReviewer([]),
      new AntigravityAdapter(new MissingCommitAntigravityTransport()),
      store,
      { maxIterations: 5 },
    );

    const result = await coordinator.run(task, 5);
    const saved = await store.load();
    assert.equal(result.state, 'FIXING');
    assert.equal(saved.issues['R-NO-COMMIT'].status, 'OPEN');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('clean-room review rechecks CI before invoking reviewer', async () => {
  const { dir, store } = await createStore('PR_CREATED');
  try {
    const coordinator = new ReviewLoopCoordinator(
      new FakeGitHub(['SUCCESS', 'FAILURE']),
      new SequenceReviewer([{ verdict: 'APPROVE', issues: [] }]),
      new SequenceReviewer([]),
      new AntigravityAdapter(new PassingAntigravityTransport()),
      store,
      { maxIterations: 5 },
    );

    const result = await coordinator.run(task, 5);
    assert.equal(result.state, 'FIXING');
    assert.equal(result.iteration, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('resumes a persisted FINAL_REVIEW state', async () => {
  const { dir, store } = await createStore('FINAL_REVIEW');
  try {
    const coordinator = new ReviewLoopCoordinator(
      new FakeGitHub(),
      new SequenceReviewer([]),
      new SequenceReviewer([{ verdict: 'APPROVE', issues: [] }]),
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

test('rejects an invalid max iteration policy', async () => {
  const { dir, store } = await createStore('PR_CREATED');
  try {
    assert.throws(
      () => new ReviewLoopCoordinator(
        new FakeGitHub(),
        new SequenceReviewer([]),
        new SequenceReviewer([]),
        new AntigravityAdapter(new PassingAntigravityTransport()),
        store,
        { maxIterations: 0 },
      ),
      /positive integer/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('human approval is required before MERGED', async () => {
  const { dir, store } = await createStore('HUMAN_APPROVAL');
  try {
    const state = await store.load();
    state.prNumber = 5;
    state.approval = createApprovalEvidence(handoff());
    await store.save(state);
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

test('merge rejects approval after PR head changes', async () => {
  const { dir, store } = await createStore('HUMAN_APPROVAL');
  try {
    const state = await store.load();
    state.prNumber = 5;
    state.approval = createApprovalEvidence(handoff());
    await store.save(state);

    const changedHandoff = handoff();
    changedHandoff.pullRequest.headSha = 'cccccccccccccccccccccccccccccccccccccccc';
    const github = { async createHandoffPacket() { return changedHandoff; } };
    const coordinator = new ReviewLoopCoordinator(
      github,
      new SequenceReviewer([]),
      new SequenceReviewer([]),
      new AntigravityAdapter(new PassingAntigravityTransport()),
      store,
      { maxIterations: 5 },
    );

    await assert.rejects(coordinator.approveMerge(), /Approval is stale/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
