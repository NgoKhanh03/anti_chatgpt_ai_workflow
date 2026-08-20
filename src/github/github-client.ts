import type { CommandRunner } from './command-runner.js';
import type {
  CiState,
  PrHandoffPacket,
  PullRequestContext,
  PullRequestDiff,
  RepositoryContext,
} from './types.js';

interface GhPrView {
  number: number;
  title: string;
  url: string;
  headRefName: string;
  baseRefName: string;
  body?: string;
  author?: { login?: string };
  statusCheckRollup?: Array<{ conclusion?: string; status?: string }>;
}

interface GhFile {
  path: string;
  additions: number;
  deletions: number;
}

function deriveCiState(checks: GhPrView['statusCheckRollup']): CiState {
  if (!checks || checks.length === 0) return 'UNKNOWN';

  const values = checks.map((check) =>
    String(check.conclusion || check.status || '').toUpperCase(),
  );

  if (values.some((value) => ['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT'].includes(value))) {
    return 'FAILURE';
  }
  if (values.some((value) => ['PENDING', 'QUEUED', 'IN_PROGRESS', 'EXPECTED'].includes(value))) {
    return 'PENDING';
  }
  if (values.every((value) => ['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(value))) {
    return 'SUCCESS';
  }
  return 'UNKNOWN';
}

export class GitHubClient {
  constructor(
    private readonly runner: CommandRunner,
    private readonly cwd: string,
  ) {}

  async getRepository(): Promise<RepositoryContext> {
    const result = await this.runner.run(
      'gh',
      ['repo', 'view', '--json', 'owner,name,defaultBranchRef'],
      this.cwd,
    );
    const data = JSON.parse(result.stdout) as {
      owner: { login: string };
      name: string;
      defaultBranchRef?: { name?: string };
    };
    return {
      owner: data.owner.login,
      name: data.name,
      defaultBranch: data.defaultBranchRef?.name,
    };
  }

  async getPullRequest(prNumber?: number): Promise<PullRequestContext> {
    const args = ['pr', 'view'];
    if (prNumber !== undefined) args.push(String(prNumber));
    args.push('--json', 'number,title,url,headRefName,baseRefName,body,author,statusCheckRollup');

    const result = await this.runner.run('gh', args, this.cwd);
    const data = JSON.parse(result.stdout) as GhPrView;

    return {
      number: data.number,
      title: data.title,
      url: data.url,
      headRefName: data.headRefName,
      baseRefName: data.baseRefName,
      body: data.body,
      author: data.author?.login,
      ciState: deriveCiState(data.statusCheckRollup),
    };
  }

  async getPullRequestDiff(prNumber: number): Promise<PullRequestDiff> {
    const [diffResult, filesResult] = await Promise.all([
      this.runner.run('gh', ['pr', 'diff', String(prNumber)], this.cwd),
      this.runner.run('gh', ['pr', 'view', String(prNumber), '--json', 'files'], this.cwd),
    ]);

    const fileData = JSON.parse(filesResult.stdout) as { files: GhFile[] };
    return {
      patch: diffResult.stdout,
      files: fileData.files.map((file) => ({
        path: file.path,
        additions: file.additions,
        deletions: file.deletions,
      })),
    };
  }

  async createHandoffPacket(prNumber?: number): Promise<PrHandoffPacket> {
    const repository = await this.getRepository();
    const pullRequest = await this.getPullRequest(prNumber);
    const diff = await this.getPullRequestDiff(pullRequest.number);

    return {
      repository,
      pullRequest,
      diff,
      generatedAt: new Date().toISOString(),
    };
  }
}
