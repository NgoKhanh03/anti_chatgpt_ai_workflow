import test from 'node:test';
import assert from 'node:assert/strict';
import { AntigravityAdapter } from '../dist/adapters/index.js';
import { CodingCycleCoordinator } from '../dist/orchestrator/index.js';

const task = {
  task: {
    id: 'FEAT-002',
    objective: 'Demo',
    acceptanceCriteria: ['Done'],
  },
  constraints: [],
  definitionOfDone: ['checks pass'],
};

function result(check = 'PASS') {
  return {
    taskId: 'FEAT-002',
    success: check === 'PASS',
    summary: 'Execution finished',
    commitSha: 'deadbeef',
    changedFiles: ['src/demo.ts'],
    checks: {
      lint: check,
      typecheck: check,
      tests: check,
      build: check,
    },
    errors: check === 'PASS' ? [] : ['check failed'],
  };
}

class Transport {
  constructor(execution) {
    this.execution = execution;
  }
  async execute() {
    return this.execution;
  }
}

test('implementation reaches TESTING when checks pass', async () => {
  const coordinator = new CodingCycleCoordinator(
    new AntigravityAdapter(new Transport(result('PASS'))),
  );
  const cycle = await coordinator.implement(task);
  assert.equal(cycle.state, 'TESTING');
});

test('implementation returns to FIXING when checks fail', async () => {
  const coordinator = new CodingCycleCoordinator(
    new AntigravityAdapter(new Transport(result('FAIL'))),
  );
  const cycle = await coordinator.implement(task);
  assert.equal(cycle.state, 'FIXING');
});

test('fix cycle performs FIXING -> TESTING', async () => {
  const coordinator = new CodingCycleCoordinator(
    new AntigravityAdapter(new Transport(result('PASS'))),
  );
  const cycle = await coordinator.fix(task, [
    { id: 'R001', severity: 'P1', problem: 'Regression' },
  ]);
  assert.equal(cycle.state, 'TESTING');
});
