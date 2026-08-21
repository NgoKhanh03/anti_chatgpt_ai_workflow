import test from 'node:test';
import assert from 'node:assert/strict';
import { PlanValidationError, topologicalSort, validatePlan } from '../dist/plan/index.js';

function validPlan() {
  return {
    id: 'PLAN-1',
    revision: 1,
    globalConstraints: ['TypeScript strict'],
    phases: [{
      id: 'PHASE-1',
      goal: 'Authentication',
      acceptanceCriteria: [{ id: 'PHASE-1.AC-1', text: 'Users can authenticate' }],
      features: [{
        id: 'AUTH-1',
        goal: 'Login API',
        acceptanceCriteria: [
          { id: 'AUTH-1.AC-1', text: 'Valid credentials succeed' },
          { id: 'AUTH-1.AC-2', text: 'Invalid credentials fail' },
        ],
        coversPhaseCriteria: ['PHASE-1.AC-1'],
        dependencies: [],
        units: [{
          id: 'AUTH-1.RU-1',
          goal: 'Authenticate credentials',
          acceptanceCriteriaIds: ['AUTH-1.AC-1', 'AUTH-1.AC-2'],
          dependencies: [],
          scope: {
            expectedFiles: ['src/auth/service.ts'],
            allowedWriteRoots: ['src/', 'tests/'],
          },
          reviewBudget: { maxFiles: 8, maxDiffLines: 600 },
        }],
      }],
    }],
  };
}

test('validates complete acceptance coverage', () => {
  const plan = validPlan();
  assert.equal(validatePlan(plan), plan);
});

test('rejects uncovered and unknown acceptance criteria', () => {
  const plan = validPlan();
  plan.phases[0].features[0].units[0].acceptanceCriteriaIds = ['AUTH-1.AC-MISSING'];
  assert.throws(
    () => validatePlan(plan),
    (error) => error instanceof PlanValidationError && error.issues.some((issue) => issue.includes('not covered')),
  );
});

test('topologicalSort rejects missing dependencies and cycles', () => {
  assert.throws(
    () => topologicalSort([{ id: 'A', dependencies: ['B'] }]),
    /missing node B/,
  );
  assert.throws(
    () => topologicalSort([
      { id: 'A', dependencies: ['B'] },
      { id: 'B', dependencies: ['A'] },
    ]),
    /cycle/,
  );
});

test('topologicalSort returns dependencies before dependents', () => {
  const ordered = topologicalSort([
    { id: 'UI', dependencies: ['API'] },
    { id: 'API', dependencies: [] },
  ]);
  assert.deepEqual(ordered.map((node) => node.id), ['API', 'UI']);
});

test('rejects dependencies on a future phase', () => {
  const plan = validPlan();
  const phaseTwo = structuredClone(plan.phases[0]);
  phaseTwo.id = 'PHASE-2';
  phaseTwo.acceptanceCriteria = [{ id: 'PHASE-2.AC-1', text: 'Billing works' }];
  phaseTwo.features[0].id = 'BILLING-1';
  phaseTwo.features[0].coversPhaseCriteria = ['PHASE-2.AC-1'];
  phaseTwo.features[0].acceptanceCriteria = [{ id: 'BILLING-1.AC-1', text: 'Charge succeeds' }];
  phaseTwo.features[0].units[0].id = 'BILLING-1.RU-1';
  phaseTwo.features[0].units[0].acceptanceCriteriaIds = ['BILLING-1.AC-1'];
  plan.phases.push(phaseTwo);
  plan.phases[0].features[0].dependencies = ['BILLING-1'];

  assert.throws(() => validatePlan(plan), /future-phase feature/);
});
