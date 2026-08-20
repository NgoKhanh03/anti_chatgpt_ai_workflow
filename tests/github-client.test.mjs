import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubClient, renderHandoffMarkdown } from '../dist/github/index.js';

class FakeRunner {
  async run(command, args) {
    assert.equal(command, 'gh');
    const joined = args.join(' ');

    if (joined === 'repo view --json owner,name,defaultBranchRef') {
      return {
        stdout: JSON.stringify({
          owner: { login: 'acme' },
          name: 'demo',
          defaultBranchRef: { name: 'main' },
        }),
        stderr: '',
      };
    }

    if (joined.includes('pr view') && joined.includes('statusCheckRollup')) {
      return {
        stdout: JSON.stringify({
          number: 42,
          title: 'Add feature',
          url: 'https://github.com/acme/demo/pull/42',
          headRefName: 'feat/demo',
          baseRefName: 'main',
          body: 'Implements demo feature',
          author: { login: 'bot' },
          statusCheckRollup: [{ conclusion: 'SUCCESS' }],
        }),
        stderr: '',
      };
    }

    if (joined === 'pr diff 42') {
      return { stdout: 'diff --git a/a.ts b/a.ts\n+hello', stderr: '' };
    }

    if (joined === 'pr view 42 --json files') {
      return {
        stdout: JSON.stringify({ files: [{ path: 'a.ts', additions: 1, deletions: 0 }] }),
        stderr: '',
      };
    }

    throw new Error(`Unexpected command: ${joined}`);
  }
}

test('creates PR handoff packet', async () => {
  const client = new GitHubClient(new FakeRunner(), '/tmp/repo');
  const packet = await client.createHandoffPacket(42);

  assert.equal(packet.repository.owner, 'acme');
  assert.equal(packet.pullRequest.number, 42);
  assert.equal(packet.pullRequest.ciState, 'SUCCESS');
  assert.equal(packet.diff.files[0].path, 'a.ts');

  const markdown = renderHandoffMarkdown(packet);
  assert.match(markdown, /PR: #42/);
  assert.match(markdown, /CI: SUCCESS/);
  assert.match(markdown, /a\.ts/);
});
