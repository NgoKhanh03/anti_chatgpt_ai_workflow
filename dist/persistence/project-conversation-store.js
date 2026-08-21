import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
export class ProjectConversationStore {
    filePath;
    writeQueue = Promise.resolve();
    constructor(filePath) {
        this.filePath = filePath;
    }
    async get(projectId) {
        return (await this.load()).projects[projectId]?.conversationId;
    }
    async set(projectId, conversationId) {
        if (!projectId.trim())
            throw new Error('Project ID is required.');
        if (!conversationId.trim())
            throw new Error('Conversation ID is required.');
        const write = this.writeQueue.then(() => this.write(projectId, conversationId));
        this.writeQueue = write.catch(() => { });
        await write;
    }
    async write(projectId, conversationId) {
        const state = await this.load();
        state.projects[projectId] = {
            conversationId,
            updatedAt: new Date().toISOString(),
        };
        await mkdir(dirname(this.filePath), { recursive: true });
        const tempPath = `${this.filePath}.tmp`;
        await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
        await rename(tempPath, this.filePath);
    }
    async load() {
        try {
            const raw = await readFile(this.filePath, 'utf8');
            const parsed = JSON.parse(raw);
            return { projects: parsed.projects ?? {} };
        }
        catch (error) {
            if (error.code === 'ENOENT')
                return { projects: {} };
            throw error;
        }
    }
}
