import test from 'node:test';
import assert from 'node:assert/strict';
import {
  InvalidTransitionError,
  canTransition,
  isTerminalState,
  transition,
} from '../dist/orchestrator/index.js';

test('allows expected happy-path transitions', () => {
  assert.equal(transition('NEW', 'CODING'), 'CODING');
  assert.equal(transition('CODING', 'TESTING'), 'TESTING');
  assert.equal(transition('TESTING', 'PR_CREATED'), 'PR_CREATED');
  assert.equal(transition('PR_CREATED', 'AI_REVIEWING'), 'AI_REVIEWING');
});

test('allows review/fix loop', () => {
  assert.equal(canTransition('AI_REVIEWING', 'FIXING'), true);
  assert.equal(canTransition('FIXING', 'TESTING'), true);
});

test('rejects invalid transitions', () => {
  assert.throws(() => transition('NEW', 'MERGED'), InvalidTransitionError);
  assert.throws(() => transition('MERGED', 'CODING'), InvalidTransitionError);
});

test('MERGED is terminal', () => {
  assert.equal(isTerminalState('MERGED'), true);
  assert.equal(isTerminalState('AI_APPROVED'), false);
});
