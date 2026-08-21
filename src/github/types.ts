export type CiState = 'PENDING' | 'SUCCESS' | 'FAILURE' | 'UNKNOWN';

export interface RepositoryContext {
  owner: string;
  name: string;
  defaultBranch?: string;
}

export interface PullRequestContext {
  number: number;
  title: string;
  url: string;
  headRefName: string;
  baseRefName: string;
  headSha: string;
  baseSha: string;
  author?: string;
  body?: string;
  ciState: CiState;
}

export interface PullRequestFile {
  path: string;
  additions: number;
  deletions: number;
  status?: string;
}

export interface PullRequestDiff {
  patch: string;
  files: PullRequestFile[];
}

export interface PrHandoffPacket {
  repository: RepositoryContext;
  pullRequest: PullRequestContext;
  diff: PullRequestDiff;
  generatedAt: string;
}

export interface PullRequestCreationInput {
  headBranch: string;
  baseBranch: string;
  title: string;
  body: string;
}

export interface CiWaitOptions {
  timeoutMs: number;
  pollIntervalMs: number;
}

export interface ReviewCommentInput {
  phase: 'review' | 'clean-room';
  iteration: number;
  headSha: string;
  verdict: 'APPROVE' | 'REQUEST_CHANGES';
  issues: Array<{
    id: string;
    severity: 'P0' | 'P1' | 'P2' | 'P3';
    file?: string;
    line?: number;
    problem: string;
    recommendedFix?: string;
  }>;
}
