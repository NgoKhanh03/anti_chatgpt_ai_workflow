import type {
  AntigravityExecutionResult,
  AntigravityRequest,
  TaskContract,
} from './types.js';
import { ScopePolicyError, evaluateScope } from '../../policy/index.js';

export interface AntigravityTransport {
  execute(request: AntigravityRequest): Promise<AntigravityExecutionResult>;
}

export class AntigravityAdapter {
  constructor(private readonly transport: AntigravityTransport) {}

  async implement(task: TaskContract): Promise<AntigravityExecutionResult> {
    const result = await this.transport.execute({
      mode: 'IMPLEMENT',
      task,
    });
    return this.validateScope(task, result);
  }

  async fix(
    task: TaskContract,
    reviewIssues: AntigravityRequest['reviewIssues'],
  ): Promise<AntigravityExecutionResult> {
    const result = await this.transport.execute({
      mode: 'FIX',
      task,
      reviewIssues,
    });
    return this.validateScope(task, result);
  }

  private validateScope(
    task: TaskContract,
    result: AntigravityExecutionResult,
  ): AntigravityExecutionResult {
    if (!task.scope) return result;
    const evaluation = evaluateScope(task.scope, result.changedFiles, result.scopeExpansionReason);
    if (evaluation.decision !== 'ALLOW') throw new ScopePolicyError(evaluation);
    return result;
  }
}
