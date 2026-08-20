import test from 'node:test';
import assert from 'node:assert/strict';
import { assertMergeAllowed, resolveBranchStrategy } from '../dist/workflow/index.js';

test('phase mode gates every phase before main', () => {
  const strategy = resolveBranchStrategy('RUN-1', ['PHASE-1', 'PHASE-2'], { mode: 'phase' });
  assert.equal(strategy.integrationBranch, undefined);
  assert.ok(strategy.phases.every((phase) => phase.mergeTarget === 'main'));
  assert.ok(strategy.phases.every((phase) => phase.requiresHumanGate));
  assert.throws(() => assertMergeAllowed(strategy, 'main', {}), /Phase approval/);
  assert.doesNotThrow(() => assertMergeAllowed(strategy, 'main', { phaseApproved: true }));
});

test('final mode routes phases through a run integration branch', () => {
  const strategy = resolveBranchStrategy('Project X', ['PHASE-1'], { mode: 'final' });
  assert.equal(strategy.integrationBranch, 'run/project-x');
  assert.equal(strategy.phases[0].mergeTarget, 'run/project-x');
  assert.equal(strategy.phases[0].requiresHumanGate, false);
  assert.doesNotThrow(() => assertMergeAllowed(strategy, 'run/project-x', {}));
  assert.throws(() => assertMergeAllowed(strategy, 'main', {}), /Final approval/);
  assert.doesNotThrow(() => assertMergeAllowed(strategy, 'main', { finalApproved: true }));
});

test('custom mode validates checkpoint phases and keeps final approval', () => {
  const strategy = resolveBranchStrategy(
    'RUN-2',
    ['PHASE-1', 'PHASE-2'],
    { mode: 'custom', afterPhases: ['PHASE-2'], final: true },
  );
  assert.equal(strategy.phases[0].requiresHumanGate, false);
  assert.equal(strategy.phases[1].requiresHumanGate, true);
  assert.throws(
    () => resolveBranchStrategy('RUN-2', ['PHASE-1'], { mode: 'custom', final: false }),
    /require final approval/,
  );
});
