import test from 'node:test';
import assert from 'node:assert/strict';
import { assertApprovalCurrent, createApprovalEvidence } from '../dist/review/index.js';

function handoff(overrides = {}) {
  return {
    repository: { owner: 'acme', name: 'demo', defaultBranch: 'main' },
    pullRequest: {
      number: 1,
      title: 'Feature',
      url: 'https://example.test/pr/1',
      headRefName: 'feat/demo',
      baseRefName: 'main',
      headSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      baseSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      ciState: 'SUCCESS',
      ...overrides,
    },
    diff: { patch: '+change', files: [{ path: 'src/a.ts', additions: 1, deletions: 0 }] },
    generatedAt: new Date().toISOString(),
  };
}

test('approval evidence is valid only for the exact reviewed Git state', () => {
  const reviewed = handoff();
  const evidence = createApprovalEvidence(reviewed, 'review-1');
  assert.doesNotThrow(() => assertApprovalCurrent(evidence, reviewed));
  assert.equal(evidence.reviewerArtifactId, 'review-1');
});

test('approval becomes stale when head SHA or diff changes', () => {
  const evidence = createApprovalEvidence(handoff());
  assert.throws(
    () => assertApprovalCurrent(
      evidence,
      handoff({ headSha: 'cccccccccccccccccccccccccccccccccccccccc' }),
    ),
    /stale/,
  );

  const changedDiff = handoff();
  changedDiff.diff.patch = '+different';
  assert.throws(() => assertApprovalCurrent(evidence, changedDiff), /stale/);
});
