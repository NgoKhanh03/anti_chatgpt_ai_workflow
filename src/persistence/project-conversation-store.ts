import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

interface ConversationRecord {
  conversationId: string;
  updatedAt: string;
}

interface ConversationState {
  projects: Record<string, ConversationRecord>;
}

export class ProjectConversationStore {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async get(projectId: string): Promise<string | undefined> {
    return (await this.load()).projects[projectId]?.conversationId;
  }

  async set(projectId: string, conversationId: string): Promise<void> {
    if (!projectId.trim()) throw new Error('Project ID is required.');
    if (!conversationId.trim()) throw new Error('Conversation ID is required.');

    const write = this.writeQueue.then(() => this.write(projectId, conversationId));
    this.writeQueue = write.catch(() => {});
    await write;
  }

  private async write(projectId: string, conversationId: string): Promise<void> {
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

  private async load(): Promise<ConversationState> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<ConversationState>;
      return { projects: parsed.projects ?? {} };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { projects: {} };
      throw error;
    }
  }
}
