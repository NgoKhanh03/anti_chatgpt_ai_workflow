import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RunLease, RunLeaseConflictError } from '../dist/persistence/index.js';

async function withLockDirectory(run) {
  const dir = await mkdtemp(join(tmpdir(), 'ai-run-lease-'));
  try {
    await run(join(dir, 'active.lock'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('prevents two owners from acquiring the same active run', async () => {
  await withLockDirectory(async (lockDirectory) => {
    const first = new RunLease(lockDirectory, 'RUN-1', 'owner-a');
    const second = new RunLease(lockDirectory, 'RUN-1', 'owner-b');
    await first.acquire();
    await assert.rejects(second.acquire(), RunLeaseConflictError);
    await first.release();
  });
});

test('heartbeat uses optimistic lease versions', async () => {
  await withLockDirectory(async (lockDirectory) => {
    let time = new Date('2026-08-20T00:00:00.000Z');
    const lease = new RunLease(lockDirectory, 'RUN-1', 'owner-a', 30_000, () => time);
    const acquired = await lease.acquire();
    time = new Date('2026-08-20T00:00:10.000Z');
    const heartbeat = await lease.heartbeat(acquired.version);
    assert.equal(heartbeat.version, 2);
    await assert.rejects(lease.heartbeat(acquired.version), /version conflict/);
    await lease.release();
  });
});

test('allows takeover after lease expiry', async () => {
  await withLockDirectory(async (lockDirectory) => {
    let time = new Date('2026-08-20T00:00:00.000Z');
    const first = new RunLease(lockDirectory, 'RUN-1', 'owner-a', 1_000, () => time);
    await first.acquire();
    time = new Date('2026-08-20T00:00:02.000Z');
    const second = new RunLease(lockDirectory, 'RUN-1', 'owner-b', 1_000, () => time);
    const acquired = await second.acquire();
    assert.equal(acquired.ownerId, 'owner-b');
    await second.release();
  });
});
