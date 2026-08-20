import type {
  AntigravityExecutionResult,
  AntigravityRequest,
  TaskContract,
} from './types.js';

export interface AntigravityTransport {
  execute(request: AntigravityRequest): Promise<AntigravityExecutionResult>;
}

export class AntigravityAdapter {
  constructor(private readonly transport: AntigravityTransport) {}

  async implement(task: TaskContract): Promise<AntigravityExecutionResult> {
    return this.transport.execute({
      mode: 'IMPLEMENT',
      task,
    });
  }

  async fix(
    task: TaskContract,
    reviewIssues: AntigravityRequest['reviewIssues'],
  ): Promise<AntigravityExecutionResult> {
    return this.transport.execute({
      mode: 'FIX',
      task,
      reviewIssues,
    });
  }
}
