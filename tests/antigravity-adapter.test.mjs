import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AntigravityAdapter,
  deterministicChecksPassed,
  hasCommit,
} from '../dist/adapters/index.js';
import { ScopePolicyError } from '../dist/policy/index.js';

const task = {
  task: {
    id: 'FEAT-001',
    objective: 'Implement demo feature',
    acceptanceCriteria: ['Feature works'],
  },
  constraints: ['No unnecessary dependency'],
  definitionOfDone: ['tests pass'],
};

class FakeTransport {
  constructor(result) {
    this.result = result;
    this.requests = [];
  }

  async execute(request) {
    this.requests.push(request);
    return this.result;
  }
}

function passingResult() {
  return {
    taskId: 'FEAT-001',
    success: true,
    summary: 'Implemented',
    branch: 'feat/demo',
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

test('sends IMPLEMENT request to Antigravity transport', async () => {
  const transport = new FakeTransport(passingResult());
  const adapter = new AntigravityAdapter(transport);
  const result = await adapter.implement(task);

  assert.equal(transport.requests.length, 1);
  assert.equal(transport.requests[0].mode, 'IMPLEMENT');
  assert.equal(transport.requests[0].task.task.id, 'FEAT-001');
  assert.equal(result.commitSha, 'abc123');
});

test('sends FIX request with review issues', async () => {
  const transport = new FakeTransport(passingResult());
  const adapter = new AntigravityAdapter(transport);
  await adapter.fix(task, [
    { id: 'R001', severity: 'P1', problem: 'Bug' },
  ]);

  assert.equal(transport.requests[0].mode, 'FIX');
  assert.equal(transport.requests[0].reviewIssues[0].id, 'R001');
});

test('validates deterministic checks and commit', () => {
  const result = passingResult();
  assert.equal(deterministicChecksPassed(result), true);
  assert.equal(hasCommit(result), true);

  result.checks.tests = 'FAIL';
  assert.equal(deterministicChecksPassed(result), false);
});

test('enforces task file scope after Antigravity execution', async () => {
  const scopedTask = {
    ...task,
    scope: {
      expectedFiles: ['src/demo.ts'],
      allowedWriteRoots: ['src/'],
    },
  };
  const outOfScope = passingResult();
  outOfScope.changedFiles = ['.github/workflows/release.yml'];

  const adapter = new AntigravityAdapter(new FakeTransport(outOfScope));
  await assert.rejects(adapter.implement(scopedTask), ScopePolicyError);
});

test('requires human approval for unapproved scope expansion', async () => {
  const scopedTask = {
    ...task,
    scope: {
      expectedFiles: ['src/demo.ts'],
      allowedWriteRoots: ['src/'],
    },
  };
  const expanded = passingResult();
  expanded.changedFiles = ['src/demo.ts', 'src/helper.ts'];

  const adapter = new AntigravityAdapter(new FakeTransport(expanded));
  await assert.rejects(
    adapter.implement(scopedTask),
    (error) => error instanceof ScopePolicyError && error.evaluation.decision === 'NEEDS_HUMAN',
  );
});
