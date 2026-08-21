import type { UnitScopePolicy } from '../../policy/index.js';

export interface TaskContract {
  task: {
    id: string;
    objective: string;
    acceptanceCriteria: string[];
  };
  constraints: string[];
  definitionOfDone: string[];
  scope?: UnitScopePolicy;
}

export type CheckStatus = 'PASS' | 'FAIL' | 'SKIPPED';

export interface ExecutionChecks {
  lint: CheckStatus;
  typecheck: CheckStatus;
  tests: CheckStatus;
  build: CheckStatus;
}

export interface AntigravityExecutionResult {
  taskId: string;
  success: boolean;
  summary: string;
  branch?: string;
  commitSha?: string;
  changedFiles: string[];
  checks: ExecutionChecks;
  errors: string[];
  scopeExpansionReason?: string;
}

export interface AntigravityRequest {
  mode: 'IMPLEMENT' | 'FIX';
  task: TaskContract;
  reviewIssues?: Array<{
    id: string;
    severity: 'P0' | 'P1' | 'P2' | 'P3';
    problem: string;
    recommendedFix?: string;
  }>;
}
