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
