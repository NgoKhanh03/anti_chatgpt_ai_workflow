import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TechnicalDebtStore } from '../dist/persistence/index.js';

async function withStore(run) {
  const dir = await mkdtemp(join(tmpdir(), 'ai-debt-store-'));
  try {
    await run(new TechnicalDebtStore(join(dir, 'debt.json')));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const issue = {
  id: 'R-P2',
  severity: 'P2',
  file: 'src/auth.ts',
  problem: 'Error handling should include context',
};

test('deduplicates recurring debt with a stable fingerprint', async () => {
  await withStore(async (store) => {
    const first = await store.sync([issue], { phaseId: 'PHASE-1', unitId: 'RU-1' });
    const second = await store.sync(
      [{ ...issue, id: 'DIFFERENT', problem: '  Error handling should include   context ' }],
      { phaseId: 'PHASE-1', unitId: 'RU-2' },
    );
    assert.equal(first[0].id, second[0].id);
    assert.equal(second[0].occurrences, 2);
  });
});

test('phase gate requires disposition while unit progress remains non-blocking', async () => {
  await withStore(async (store) => {
    const [record] = await store.sync([issue], { phaseId: 'PHASE-1', unitId: 'RU-1' });
    const policy = { requireDispositionAtPhaseGate: true, requireResolutionAtFinal: ['P2'] };
    assert.equal((await store.evaluateGate('PHASE', policy)).allowed, false);

    await store.accept(record.id, 'team-auth', 'Tracked for Phase 2', 'PHASE-2');
    assert.equal((await store.evaluateGate('PHASE', policy)).allowed, true);
    assert.equal((await store.evaluateGate('FINAL', policy)).allowed, false);

    await store.resolve(record.id, 'Added contextual errors');
    assert.equal((await store.evaluateGate('FINAL', policy)).allowed, true);
  });
});

test('resolved debt reopens when reviewer finds it again', async () => {
  await withStore(async (store) => {
    const [record] = await store.sync([issue], { phaseId: 'PHASE-1', unitId: 'RU-1' });
    await store.resolve(record.id, 'Fixed');
    const [reopened] = await store.sync([issue], { phaseId: 'PHASE-2', unitId: 'RU-3' });
    assert.equal(reopened.status, 'OPEN');
    assert.equal(reopened.resolution, undefined);
  });
});
