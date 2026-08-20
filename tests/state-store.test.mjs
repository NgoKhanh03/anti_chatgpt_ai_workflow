import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { StateStore, createInitialState } from '../dist/state/index.js';

test('persists and resumes workflow state', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ai-workflow-'));
  const file = join(dir, 'review-state.json');
  const store = new StateStore(file);

  try {
    const state = createInitialState();
    state.state = 'CODING';
    state.iteration = 1;
    state.taskId = 'TEST-001';

    await store.save(state);
    const restored = await store.load();

    assert.equal(restored.state, 'CODING');
    assert.equal(restored.iteration, 1);
    assert.equal(restored.taskId, 'TEST-001');
    assert.deepEqual(restored.issues, {});
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
