import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface CommandResult {
  stdout: string;
  stderr: string;
}

export interface CommandRunner {
  run(command: string, args: string[], cwd?: string): Promise<CommandResult>;
}

export class NodeCommandRunner implements CommandRunner {
  async run(command: string, args: string[], cwd?: string): Promise<CommandResult> {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
    });
    return { stdout, stderr };
  }
}
