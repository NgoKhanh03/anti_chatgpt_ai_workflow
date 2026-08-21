import test from 'node:test';
import assert from 'node:assert/strict';
import { AgyAntigravityTransport } from '../dist/adapters/index.js';

const task = {
  task: { id: 'FEAT-AGY', objective: 'Implement feature', acceptanceCriteria: ['Works'] },
  constraints: [],
  definitionOfDone: ['tests pass'],
};

class FakeRunner {
  constructor() {
    this.headReads = 0;
    this.calls = [];
  }

  async run(command, args, cwd) {
    this.calls.push({ command, args, cwd });
    if (command === 'git' && args.join(' ') === 'rev-parse HEAD') {
      this.headReads += 1;
      return { stdout: this.headReads === 1 ? 'before\n' : 'after\n', stderr: '' };
    }
    if (command === 'agy') {
      return {
        stdout: JSON.stringify({
          status: 'SUCCESS',
          response: `${JSON.stringify({ ok: true, toolAction: 'finish' })}\n\`\`\`json\n${JSON.stringify({
            taskId: 'FEAT-AGY',
            success: true,
            summary: 'Implemented',
            changedFiles: ['untrusted.ts'],
            checks: { lint: 'passed', type_check: true, test: 'SUCCESS', build: 'OK' },
            errors: [],
          })}\n\`\`\``,
        }),
        stderr: '',
      };
    }
    if (command === 'git' && args.join(' ') === 'branch --show-current') {
      return { stdout: 'codex/feat-agy\n', stderr: '' };
    }
    if (command === 'git' && args.join(' ') === 'diff --name-only before..after') {
      return { stdout: 'src/feature.ts\ntests/feature.test.ts\n', stderr: '' };
    }
    throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
  }
}

test('Agy transport enforces structured output and derives git evidence', async () => {
  const runner = new FakeRunner();
  const transport = new AgyAntigravityTransport(runner, {
    cwd: '/tmp/repo',
    autoApprovePermissions: true,
  });

  const result = await transport.execute({ mode: 'IMPLEMENT', task });
  assert.equal(result.branch, 'codex/feat-agy');
  assert.equal(result.commitSha, 'after');
  assert.deepEqual(result.changedFiles, ['src/feature.ts', 'tests/feature.test.ts']);

  const agyCall = runner.calls.find((call) => call.command === 'agy');
  assert.equal(agyCall.args.includes('--json-schema'), false);
  assert.ok(agyCall.args.includes('--dangerously-skip-permissions'));
  assert.ok(agyCall.args.includes('--new-project'));
  assert.match(agyCall.args[agyCall.args.indexOf('--print') + 1], /Do not push/);
});

test('Agy transport fails readiness when no commit was created', async () => {
  const runner = new FakeRunner();
  runner.run = async function (command, args, cwd) {
    if (command === 'git' && args.join(' ') === 'rev-parse HEAD') {
      return { stdout: 'same\n', stderr: '' };
    }
    return FakeRunner.prototype.run.call(this, command, args, cwd);
  };
  const transport = new AgyAntigravityTransport(runner, { cwd: '/tmp/repo' });
  const result = await transport.execute({ mode: 'IMPLEMENT', task });
  assert.equal(result.success, false);
  assert.equal(result.commitSha, undefined);
  assert.match(result.errors.at(-1), /did not create a commit/);
});

test('Agy transport preserves git evidence when completion JSON is malformed', async () => {
  const runner = new FakeRunner();
  const baseRun = runner.run.bind(runner);
  runner.run = async (command, args, cwd) => {
    if (command === 'agy') {
      return { stdout: JSON.stringify({ status: 'SUCCESS', response: '{"ok":true}' }), stderr: '' };
    }
    return baseRun(command, args, cwd);
  };
  const transport = new AgyAntigravityTransport(runner, { cwd: '/tmp/repo' });
  const result = await transport.execute({ mode: 'IMPLEMENT', task });
  assert.equal(result.success, false);
  assert.equal(result.commitSha, 'after');
  assert.deepEqual(result.changedFiles, ['src/feature.ts', 'tests/feature.test.ts']);
  assert.match(result.errors[0], /task result JSON/);
});
