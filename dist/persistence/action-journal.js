import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
function stableValue(value) {
    if (Array.isArray(value))
        return value.map(stableValue);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, entry]) => [key, stableValue(entry)]));
    }
    return value;
}
export function stableInputHash(value) {
    return createHash('sha256')
        .update(JSON.stringify(stableValue(value)))
        .digest('hex');
}
export class ActionJournal {
    filePath;
    constructor(filePath) {
        this.filePath = filePath;
    }
    async read() {
        try {
            const raw = await readFile(this.filePath, 'utf8');
            const parsed = JSON.parse(raw);
            if (parsed.version !== 1 || !parsed.actions || typeof parsed.actions !== 'object') {
                throw new Error('Unsupported action journal format.');
            }
            return parsed;
        }
        catch (error) {
            if (error.code === 'ENOENT') {
                return { version: 1, actions: {} };
            }
            throw error;
        }
    }
    async write(file) {
        await mkdir(dirname(this.filePath), { recursive: true });
        const tempPath = `${this.filePath}.tmp`;
        await writeFile(tempPath, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
        await rename(tempPath, this.filePath);
    }
    async begin(id, kind, inputHash) {
        if (!id || !kind || !inputHash)
            throw new Error('Action id, kind and inputHash are required.');
        const file = await this.read();
        const existing = file.actions[id];
        if (existing) {
            if (existing.kind !== kind || existing.inputHash !== inputHash) {
                throw new Error(`Idempotency key ${id} was reused with different input.`);
            }
            if (existing.status === 'COMPLETED')
                return { decision: 'REUSE', record: existing };
            if (existing.status === 'STARTED')
                return { decision: 'RECONCILE', record: existing };
        }
        const now = new Date().toISOString();
        const record = {
            id,
            kind,
            inputHash,
            status: 'STARTED',
            attempt: (existing?.attempt ?? 0) + 1,
            startedAt: now,
            updatedAt: now,
        };
        file.actions[id] = record;
        await this.write(file);
        return { decision: 'EXECUTE', record };
    }
    async complete(id, result = {}) {
        return this.update(id, (record) => ({
            ...record,
            ...result,
            status: 'COMPLETED',
            error: undefined,
            updatedAt: new Date().toISOString(),
        }));
    }
    async fail(id, error) {
        if (!error)
            throw new Error('Action failure requires an error message.');
        return this.update(id, (record) => ({
            ...record,
            status: 'FAILED',
            error,
            updatedAt: new Date().toISOString(),
        }));
    }
    async get(id) {
        return (await this.read()).actions[id];
    }
    async list() {
        return Object.values((await this.read()).actions);
    }
    async update(id, mutate) {
        const file = await this.read();
        const existing = file.actions[id];
        if (!existing)
            throw new Error(`Action ${id} does not exist.`);
        const updated = mutate(existing);
        file.actions[id] = updated;
        await this.write(file);
        return updated;
    }
}
