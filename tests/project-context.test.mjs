import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadProjectReviewContext } from '../dist/planning/index.js';

test('loads and bounds project overview and progress', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'project-context-'));
  try {
    await writeFile(join(dir, 'overview.md'), 'overview');
    await writeFile(join(dir, 'progress.md'), '0123456789');
    const context = await loadProjectReviewContext({
      projectId: 'owner/repo',
      root: dir,
      overviewFile: 'overview.md',
      progressFile: 'progress.md',
      maxCharactersPerSection: 5,
    });
    assert.equal(context.overview, 'overv\n\n[Context truncated at 5 characters]');
    assert.match(context.progress, /^01234/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
