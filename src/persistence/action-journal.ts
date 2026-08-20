import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export type ActionStatus = 'STARTED' | 'COMPLETED' | 'FAILED';
export type ActionDecision = 'EXECUTE' | 'REUSE' | 'RECONCILE';

export interface ActionRecord {
  id: string;
  kind: string;
  inputHash: string;
  status: ActionStatus;
  attempt: number;
  startedAt: string;
  updatedAt: string;
  externalId?: string;
  resultHash?: string;
  error?: string;
}

interface ActionJournalFile {
  version: 1;
  actions: Record<string, ActionRecord>;
}

export interface BeginActionResult {
  decision: ActionDecision;
  record: ActionRecord;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)]),
    );
  }
  return value;
}

export function stableInputHash(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(stableValue(value)))
    .digest('hex');
}

export class ActionJournal {
  constructor(private readonly filePath: string) {}

  private async read(): Promise<ActionJournalFile> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as ActionJournalFile;
      if (parsed.version !== 1 || !parsed.actions || typeof parsed.actions !== 'object') {
        throw new Error('Unsupported action journal format.');
      }
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { version: 1, actions: {} };
      }
      throw error;
    }
  }

  private async write(file: ActionJournalFile): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
    await rename(tempPath, this.filePath);
  }

  async begin(id: string, kind: string, inputHash: string): Promise<BeginActionResult> {
    if (!id || !kind || !inputHash) throw new Error('Action id, kind and inputHash are required.');

    const file = await this.read();
    const existing = file.actions[id];
    if (existing) {
      if (existing.kind !== kind || existing.inputHash !== inputHash) {
        throw new Error(`Idempotency key ${id} was reused with different input.`);
      }
      if (existing.status === 'COMPLETED') return { decision: 'REUSE', record: existing };
      if (existing.status === 'STARTED') return { decision: 'RECONCILE', record: existing };
    }

    const now = new Date().toISOString();
    const record: ActionRecord = {
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

  async complete(
    id: string,
    result: { externalId?: string; resultHash?: string } = {},
  ): Promise<ActionRecord> {
    return this.update(id, (record) => ({
      ...record,
      ...result,
      status: 'COMPLETED',
      error: undefined,
      updatedAt: new Date().toISOString(),
    }));
  }

  async fail(id: string, error: string): Promise<ActionRecord> {
    if (!error) throw new Error('Action failure requires an error message.');
    return this.update(id, (record) => ({
      ...record,
      status: 'FAILED',
      error,
      updatedAt: new Date().toISOString(),
    }));
  }

  async get(id: string): Promise<ActionRecord | undefined> {
    return (await this.read()).actions[id];
  }

  async list(): Promise<ActionRecord[]> {
    return Object.values((await this.read()).actions);
  }

  private async update(
    id: string,
    mutate: (record: ActionRecord) => ActionRecord,
  ): Promise<ActionRecord> {
    const file = await this.read();
    const existing = file.actions[id];
    if (!existing) throw new Error(`Action ${id} does not exist.`);
    const updated = mutate(existing);
    file.actions[id] = updated;
    await this.write(file);
    return updated;
  }
}
