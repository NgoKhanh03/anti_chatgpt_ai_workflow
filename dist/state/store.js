import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
export class StateStore {
    filePath;
    constructor(filePath) {
        this.filePath = filePath;
    }
    async save(state) {
        await mkdir(dirname(this.filePath), { recursive: true });
        const nextState = { ...state, updatedAt: new Date().toISOString() };
        const tempPath = `${this.filePath}.tmp`;
        await writeFile(tempPath, `${JSON.stringify(nextState, null, 2)}\n`, 'utf8');
        await rename(tempPath, this.filePath);
    }
    async load() {
        const raw = await readFile(this.filePath, 'utf8');
        return JSON.parse(raw);
    }
}
