import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ActionJournal, stableInputHash } from '../dist/persistence/index.js';

async function withJournal(run) {
  const dir = await mkdtemp(join(tmpdir(), 'ai-action-journal-'));
  try {
    await run(new ActionJournal(join(dir, 'actions.json')));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('stableInputHash ignores object key order', () => {
  assert.equal(
    stableInputHash({ b: 2, a: { d: 4, c: 3 } }),
    stableInputHash({ a: { c: 3, d: 4 }, b: 2 }),
  );
});

test('completed action is reused without another execution', async () => {
  await withJournal(async (journal) => {
    const hash = stableInputHash({ headSha: 'abc' });
    assert.equal((await journal.begin('push-1', 'git.push', hash)).decision, 'EXECUTE');
    await journal.complete('push-1', { externalId: 'abc' });

    const repeated = await journal.begin('push-1', 'git.push', hash);
    assert.equal(repeated.decision, 'REUSE');
    assert.equal(repeated.record.externalId, 'abc');
  });
});

test('interrupted action requires reconciliation before retry', async () => {
  await withJournal(async (journal) => {
    const hash = stableInputHash({ pr: 42 });
    await journal.begin('review-1', 'review.request', hash);

    const resumed = await journal.begin('review-1', 'review.request', hash);
    assert.equal(resumed.decision, 'RECONCILE');

    await journal.fail('review-1', 'external action not found');
    const retry = await journal.begin('review-1', 'review.request', hash);
    assert.equal(retry.decision, 'EXECUTE');
    assert.equal(retry.record.attempt, 2);
  });
});

test('rejects reuse of an idempotency key with different input', async () => {
  await withJournal(async (journal) => {
    await journal.begin('commit-1', 'git.commit', stableInputHash({ tree: 'one' }));
    await assert.rejects(
      journal.begin('commit-1', 'git.commit', stableInputHash({ tree: 'two' })),
      /different input/,
    );
  });
});
