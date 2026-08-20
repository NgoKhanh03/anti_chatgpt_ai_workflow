import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUnitReviewContext, createSystemReviewSlices } from '../dist/planning/index.js';

function handoff(patch = '+change', files = [{ path: 'src/a.ts', additions: 1, deletions: 0 }]) {
  return {
    repository: { owner: 'acme', name: 'demo', defaultBranch: 'main' },
    pullRequest: {
      number: 1,
      title: 'Feature',
      url: 'https://example.test/pr/1',
      headRefName: 'phase/one',
      baseRefName: 'main',
      headSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      baseSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      ciState: 'SUCCESS',
    },
    diff: { patch, files },
    generatedAt: new Date().toISOString(),
  };
}

function input(overrides = {}) {
  return {
    runId: 'RUN-1',
    phase: { id: 'PHASE-1', goal: 'Authentication' },
    feature: {
      id: 'AUTH-1',
      goal: 'Login',
      acceptanceCriteria: [{ id: 'AUTH-1.AC-1', text: 'Valid login succeeds' }],
    },
    unit: {
      id: 'AUTH-1.RU-1',
      goal: 'Credential validation',
      acceptanceCriteriaIds: ['AUTH-1.AC-1'],
      dependencies: [],
      scope: { expectedFiles: ['src/a.ts'], allowedWriteRoots: ['src/'] },
      reviewBudget: { maxFiles: 2, maxDiffLines: 10 },
    },
    globalConstraints: ['TypeScript strict'],
    dependencyEvidence: [],
    handoff: handoff(),
    ...overrides,
  };
}

test('builds a bounded unit review context', () => {
  const context = buildUnitReviewContext(input());
  assert.equal(context.decision, 'READY');
  assert.match(context.markdown, /AUTH-1\.AC-1/);
  assert.match(context.markdown, /Commit Range/);
});

test('requires unit splitting when diff budget is exceeded', () => {
  const files = [
    { path: 'src/a.ts', additions: 1, deletions: 0 },
    { path: 'src/b.ts', additions: 1, deletions: 0 },
    { path: 'src/c.ts', additions: 1, deletions: 0 },
  ];
  const context = buildUnitReviewContext(input({ handoff: handoff('+a\n+b\n+c', files) }));
  assert.equal(context.decision, 'SPLIT_REQUIRED');
  assert.match(context.reasons[0], /Changed files/);
});

test('splits final system review into bounded evidence slices', () => {
  const evidence = [1, 2, 3].map((index) => ({
    phaseId: `PHASE-${index}`,
    goal: `Goal ${index}`,
    acceptanceSummary: ['done'],
    artifactPath: `.workflow/phase-${index}/review.json`,
    headSha: String(index).repeat(40),
    changedFiles: [`src/${index}.ts`],
    riskTags: index === 3 ? ['billing'] : ['auth'],
    estimatedTokens: 400,
  }));
  const slices = createSystemReviewSlices(evidence, 800);
  assert.equal(slices.length, 2);
  assert.ok(slices.every((slice) => slice.estimatedTokens <= 800));
  assert.deepEqual(slices[0].evidence.map((item) => item.phaseId), ['PHASE-1', 'PHASE-2']);
});
