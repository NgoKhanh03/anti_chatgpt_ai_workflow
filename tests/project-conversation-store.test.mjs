import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectConversationStore } from '../dist/persistence/index.js';

test('persists one ChatGPT conversation per project', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'project-conversation-'));
  try {
    const file = join(dir, 'conversations.json');
    const store = new ProjectConversationStore(file);
    assert.equal(await store.get('owner/repo'), undefined);
    await store.set('owner/repo', 'conversation-123');
    assert.equal(await new ProjectConversationStore(file).get('owner/repo'), 'conversation-123');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('serializes concurrent project conversation updates', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'project-conversation-'));
  try {
    const file = join(dir, 'conversations.json');
    const store = new ProjectConversationStore(file);
    await Promise.all([
      store.set('owner/one', 'conversation-one'),
      store.set('owner/two', 'conversation-two'),
    ]);
    assert.equal(await store.get('owner/one'), 'conversation-one');
    assert.equal(await store.get('owner/two'), 'conversation-two');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
