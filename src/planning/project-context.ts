import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const DEFAULT_CONTEXT_LIMIT = 12_000;

async function readBounded(filePath: string | undefined, limit: number): Promise<string | undefined> {
  if (!filePath) return undefined;
  const content = await readFile(filePath, 'utf8');
  if (content.length <= limit) return content;
  return `${content.slice(0, limit)}\n\n[Context truncated at ${limit} characters]`;
}

export interface LoadProjectContextOptions {
  projectId: string;
  root: string;
  overviewFile?: string;
  progressFile?: string;
  maxCharactersPerSection?: number;
}

export async function loadProjectReviewContext(options: LoadProjectContextOptions) {
  const limit = options.maxCharactersPerSection ?? DEFAULT_CONTEXT_LIMIT;
  return {
    projectId: options.projectId,
    forceNewConversation: false,
    overview: await readBounded(
      options.overviewFile ? resolve(options.root, options.overviewFile) : undefined,
      limit,
    ),
    progress: await readBounded(
      options.progressFile ? resolve(options.root, options.progressFile) : undefined,
      limit,
    ),
  };
}
