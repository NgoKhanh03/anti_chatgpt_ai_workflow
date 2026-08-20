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
    id: 'INTEGRATION-001',
    objective: 'Exercise complete review/fix/final gate workflow',
    acceptanceCriteria: ['Workflow reaches human approval'],
  },
  constraints: [],
  definitionOfDone: ['checks pass'],
};

class FakeGitHub {
  async createHandoffPacket(prNumber) {
    return {
      repository: { owner: 'acme', name: 'integration' },
      pullRequest: {
        number: prNumber,
        title: 'Integration PR',
        url: `https://github.com/acme/integration/pull/${prNumber}`,
        headRefName: 'feat/integration',
        baseRefName: 'main',
        ciState: 'SUCCESS',
      },
      diff: { patch: 'diff', files: [{ path: 'src/app.ts', additions: 1, deletions: 0 }] },
      generatedAt: new Date().toISOString(),
    };
  }
}

class SequenceReviewer {
  constructor(results) { this.results = [...results]; }
  async review() {
    const result = this.results.shift();
    if (!result) throw new Error('No review configured');
    return result;
  }
}

class PassingCodingTransport {
  async execute(request) {
    return {
      taskId: request.task.task.id,
      success: true,
      summary: 'fixed',
      branch: 'feat/integration',
      commitSha: 'cafebabe',
      changedFiles: ['src/app.ts'],
      checks: { lint: 'PASS', typecheck: 'PASS', tests: 'PASS', build: 'PASS' },
      errors: [],
    };
  }
}

test('full review loop reaches HUMAN_APPROVAL with verified issue', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ai-workflow-integration-'));
  const store = new StateStore(join(dir, 'state.json'));
  try {
    await store.save({
      state: 'PR_CREATED',
      iteration: 0,
      issues: {},
      updatedAt: new Date().toISOString(),
    });

    const coordinator = new ReviewLoopCoordinator(
      new FakeGitHub(),
      new SequenceReviewer([
        { verdict: 'REQUEST_CHANGES', issues: [{ id: 'R001', severity: 'P1', problem: 'Bug' }] },
        { verdict: 'APPROVE', issues: [] },
      ]),
      new SequenceReviewer([{ verdict: 'APPROVE', issues: [] }]),
      new AntigravityAdapter(new PassingCodingTransport()),
      store,
      { maxIterations: 5 },
    );

    const result = await coordinator.run(task, 101);
    const saved = await store.load();
    assert.equal(result.state, 'HUMAN_APPROVAL');
    assert.equal(saved.issues.R001.status, 'VERIFIED');
    assert.equal(saved.iteration, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
