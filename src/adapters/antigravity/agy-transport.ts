import type { CommandRunner } from '../../github/index.js';
import type {
  AntigravityExecutionResult,
  AntigravityRequest,
  CheckStatus,
  ExecutionChecks,
} from './types.js';

interface AgyEnvelope {
  conversation_id?: string;
  status?: string;
  response?: string;
  structured_output?: unknown;
  error?: string;
}

export interface AgyAntigravityTransportOptions {
  cwd: string;
  command?: string;
  agent?: string;
  model?: string;
  effort?: 'low' | 'medium' | 'high';
  printTimeout?: string;
  autoApprovePermissions?: boolean;
}

const CHECK_STATUSES = new Set<CheckStatus>(['PASS', 'FAIL', 'SKIPPED']);

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Antigravity result ${field} must be a non-empty string.`);
  }
  return value;
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`Antigravity result ${field} must be a string array.`);
  }
  return value as string[];
}

function parseChecks(value: unknown): ExecutionChecks {
  if (!value || typeof value !== 'object') {
    throw new Error('Antigravity result checks must be an object.');
  }
  const source = value as Record<string, unknown>;
  const result = {} as ExecutionChecks;
  for (const key of ['lint', 'typecheck', 'tests', 'build'] as const) {
    const status = key === 'tests'
      ? source.tests ?? source.test
      : key === 'typecheck'
        ? source.typecheck ?? source.typeCheck ?? source.type_check
        : source[key];
    if (typeof status === 'boolean') {
      result[key] = status ? 'PASS' : 'FAIL';
      continue;
    }
    const normalized = typeof status === 'string' ? status.trim().toUpperCase() : '';
    if (['PASSED', 'SUCCESS', 'SUCCESSFUL', 'OK'].includes(normalized)) {
      result[key] = 'PASS';
      continue;
    }
    if (['FAILED', 'FAILURE', 'ERROR'].includes(normalized)) {
      result[key] = 'FAIL';
      continue;
    }
    if (!CHECK_STATUSES.has(normalized as CheckStatus)) {
      throw new Error(`Antigravity result checks.${key} is invalid: ${JSON.stringify(status)}.`);
    }
    result[key] = normalized as CheckStatus;
  }
  return result;
}

function parseResponseJson(response: string | undefined): unknown {
  if (!response?.trim()) throw new Error('Antigravity response is empty.');
  const candidates: string[] = [];
  for (const match of response.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    if (match[1]) candidates.push(match[1]);
  }

  let start = -1;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < response.length; index += 1) {
    const character = response[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === '{') {
      if (depth === 0) start = index;
      depth += 1;
    } else if (character === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) candidates.push(response.slice(start, index + 1));
    }
  }

  for (const candidate of candidates.reverse()) {
    try {
      const parsed = JSON.parse(candidate.trim()) as Record<string, unknown>;
      if (typeof parsed.taskId === 'string' && parsed.checks && typeof parsed.checks === 'object') {
        return parsed;
      }
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error('Antigravity response does not contain a task result JSON object.');
}

function parseStructuredResult(value: unknown): Omit<AntigravityExecutionResult, 'branch' | 'commitSha'> {
  if (!value || typeof value !== 'object') {
    throw new Error('Antigravity did not return structured output.');
  }
  const source = value as Record<string, unknown>;
  if (typeof source.success !== 'boolean') {
    throw new Error('Antigravity result success must be boolean.');
  }
  const result: Omit<AntigravityExecutionResult, 'branch' | 'commitSha'> = {
    taskId: requireString(source.taskId, 'taskId'),
    success: source.success,
    summary: requireString(source.summary, 'summary'),
    changedFiles: stringArray(source.changedFiles, 'changedFiles'),
    checks: parseChecks(source.checks),
    errors: stringArray(source.errors, 'errors'),
  };
  if (typeof source.scopeExpansionReason === 'string') {
    result.scopeExpansionReason = source.scopeExpansionReason;
  }
  return result;
}

function renderPrompt(request: AntigravityRequest): string {
  const issues = request.reviewIssues?.length
    ? `\nBlocking review issues to fix:\n${JSON.stringify(request.reviewIssues, null, 2)}`
    : '';
  return [
    `Act as the coding agent in ${request.mode} mode.`,
    'Work only inside the current repository and current branch.',
    'Implement the task, run the repository deterministic checks, and create a normal git commit.',
    'Do not push, create a pull request, comment on GitHub, merge, or rewrite published history; the orchestrator owns those actions.',
    'Return an honest JSON result with taskId, success, summary, changedFiles, checks, and errors.',
    'Each check value must be PASS, FAIL, or SKIPPED. Mark SKIPPED only when the repository has no corresponding check.',
    `Task contract:\n${JSON.stringify(request.task, null, 2)}`,
    issues,
  ].filter(Boolean).join('\n\n');
}

export class AgyAntigravityTransport {
  constructor(
    private readonly runner: CommandRunner,
    private readonly options: AgyAntigravityTransportOptions,
  ) {}

  private async gitEvidence(before: string) {
    const branch = (await this.runner.run('git', ['branch', '--show-current'], this.options.cwd)).stdout.trim();
    const head = (await this.runner.run('git', ['rev-parse', 'HEAD'], this.options.cwd)).stdout.trim();
    const changedFiles = head === before
      ? []
      : (await this.runner.run('git', ['diff', '--name-only', `${before}..${head}`], this.options.cwd))
          .stdout.split('\n').map((file) => file.trim()).filter(Boolean);
    return { branch, head, changedFiles };
  }

  private failedResult(
    request: AntigravityRequest,
    evidence: Awaited<ReturnType<AgyAntigravityTransport['gitEvidence']>>,
    error: unknown,
  ): AntigravityExecutionResult {
    return {
      taskId: request.task.task.id,
      success: false,
      summary: 'Antigravity execution requires another fix pass.',
      branch: evidence.branch,
      commitSha: evidence.changedFiles.length > 0 ? evidence.head : undefined,
      changedFiles: evidence.changedFiles,
      checks: { lint: 'FAIL', typecheck: 'FAIL', tests: 'FAIL', build: 'FAIL' },
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }

  async execute(request: AntigravityRequest): Promise<AntigravityExecutionResult> {
    const before = (await this.runner.run('git', ['rev-parse', 'HEAD'], this.options.cwd)).stdout.trim();
    const args = [
      '--print',
      renderPrompt(request),
      '--mode',
      'accept-edits',
      '--output-format',
      'json',
      '--print-timeout',
      this.options.printTimeout ?? '30m',
      '--effort',
      this.options.effort ?? 'high',
      '--new-project',
    ];
    if (this.options.agent) args.push('--agent', this.options.agent);
    if (this.options.model) args.push('--model', this.options.model);
    if (this.options.autoApprovePermissions) args.push('--dangerously-skip-permissions');

    let commandResult;
    try {
      commandResult = await this.runner.run(this.options.command ?? 'agy', args, this.options.cwd);
    } catch (error) {
      return this.failedResult(request, await this.gitEvidence(before), error);
    }
    const evidence = await this.gitEvidence(before);
    let envelope: AgyEnvelope;
    try {
      envelope = JSON.parse(commandResult.stdout) as AgyEnvelope;
    } catch (error) {
      return this.failedResult(
        request,
        evidence,
        new Error(`Antigravity CLI returned invalid JSON: ${String(error)}`),
      );
    }
    if (envelope.status !== 'SUCCESS') {
      return this.failedResult(
        request,
        evidence,
        new Error(`Antigravity CLI failed with status ${envelope.status ?? 'UNKNOWN'}: ${envelope.error ?? envelope.response ?? commandResult.stderr}`),
      );
    }

    let reported: Omit<AntigravityExecutionResult, 'branch' | 'commitSha'>;
    try {
      reported = parseStructuredResult(
        envelope.structured_output ?? parseResponseJson(envelope.response),
      );
    } catch (error) {
      return this.failedResult(request, evidence, error);
    }
    if (reported.taskId !== request.task.task.id) {
      return this.failedResult(
        request,
        evidence,
        new Error(`Antigravity returned task ${reported.taskId}, expected ${request.task.task.id}.`),
      );
    }

    return {
      ...reported,
      success: reported.success && evidence.head !== before,
      branch: evidence.branch,
      commitSha: evidence.head !== before ? evidence.head : undefined,
      changedFiles: evidence.changedFiles,
      errors: evidence.head === before
        ? [...reported.errors, 'Antigravity did not create a commit.']
        : reported.errors,
    };
  }
}
