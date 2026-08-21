import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateOperation, evaluateScope } from '../dist/policy/index.js';

const policy = {
  expectedFiles: ['src/auth/service.ts'],
  allowedWriteRoots: ['src/', 'tests/'],
};

test('allows expected files and denies protected paths', () => {
  assert.equal(evaluateScope(policy, ['src/auth/service.ts']).decision, 'ALLOW');

  const protectedResult = evaluateScope(policy, ['.env']);
  assert.equal(protectedResult.decision, 'DENY');
  assert.match(protectedResult.violations[0], /Protected path/);
});

test('reasoned expansion must be enabled explicitly', () => {
  assert.equal(
    evaluateScope(policy, ['src/auth/helper.ts'], 'needed helper').decision,
    'NEEDS_HUMAN',
  );
  assert.equal(
    evaluateScope(
      { ...policy, allowReasonedExpansion: true },
      ['src/auth/helper.ts'],
      'needed helper',
    ).decision,
    'ALLOW',
  );
});

test('destructive, secret and external operations require human approval', () => {
  const operationPolicy = { allowedKinds: ['test.run', 'database.migrate'] };
  assert.equal(
    evaluateOperation(operationPolicy, { kind: 'test.run' }).decision,
    'ALLOW',
  );
  assert.equal(
    evaluateOperation(operationPolicy, { kind: 'database.migrate', destructive: true }).decision,
    'NEEDS_HUMAN',
  );
  assert.equal(
    evaluateOperation(operationPolicy, { kind: 'github.merge', externalSideEffect: true }).decision,
    'NEEDS_HUMAN',
  );
});
