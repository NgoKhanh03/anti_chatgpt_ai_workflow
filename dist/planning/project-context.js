import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const DEFAULT_CONTEXT_LIMIT = 12_000;
async function readBounded(filePath, limit) {
    if (!filePath)
        return undefined;
    const content = await readFile(filePath, 'utf8');
    if (content.length <= limit)
        return content;
    return `${content.slice(0, limit)}\n\n[Context truncated at ${limit} characters]`;
}
export async function loadProjectReviewContext(options) {
    const limit = options.maxCharactersPerSection ?? DEFAULT_CONTEXT_LIMIT;
    return {
        projectId: options.projectId,
        overview: await readBounded(options.overviewFile ? resolve(options.root, options.overviewFile) : undefined, limit),
        progress: await readBounded(options.progressFile ? resolve(options.root, options.progressFile) : undefined, limit),
    };
}
