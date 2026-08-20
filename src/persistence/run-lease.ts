import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';

export interface RunLeaseRecord {
  runId: string;
  ownerId: string;
  host: string;
  pid: number;
  acquiredAt: string;
  heartbeatAt: string;
  expiresAt: string;
  version: number;
}

export class RunLeaseConflictError extends Error {
  constructor(readonly lease: RunLeaseRecord) {
    super(`Run ${lease.runId} is already leased by ${lease.ownerId} until ${lease.expiresAt}.`);
    this.name = 'RunLeaseConflictError';
  }
}

export class RunLease {
  private readonly leaseFile: string;

  constructor(
    private readonly lockDirectory: string,
    private readonly runId: string,
    private readonly ownerId: string,
    private readonly ttlMs = 30_000,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (!runId || !ownerId) throw new Error('Run lease requires runId and ownerId.');
    if (!Number.isInteger(ttlMs) || ttlMs <= 0) throw new Error('Run lease ttlMs must be positive.');
    this.leaseFile = join(lockDirectory, 'lease.json');
  }

  async acquire(): Promise<RunLeaseRecord> {
    await mkdir(dirname(this.lockDirectory), { recursive: true });
    const current = this.now();
    const lease: RunLeaseRecord = {
      runId: this.runId,
      ownerId: this.ownerId,
      host: hostname(),
      pid: process.pid,
      acquiredAt: current.toISOString(),
      heartbeatAt: current.toISOString(),
      expiresAt: new Date(current.getTime() + this.ttlMs).toISOString(),
      version: 1,
    };
    const candidateDirectory = `${this.lockDirectory}.candidate-${this.ownerId}-${process.pid}-${Date.now()}`;
    await mkdir(candidateDirectory);
    await writeFile(join(candidateDirectory, 'lease.json'), `${JSON.stringify(lease, null, 2)}\n`, 'utf8');

    try {
      await rename(candidateDirectory, this.lockDirectory);
      return lease;
    } catch (error) {
      await rm(candidateDirectory, { recursive: true, force: true });
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST' && code !== 'ENOTEMPTY') throw error;
      const existing = await this.read();
      if (new Date(existing.expiresAt).getTime() > this.now().getTime()) {
        throw new RunLeaseConflictError(existing);
      }

      const staleDirectory = `${this.lockDirectory}.stale-${Date.now()}-${this.ownerId}`;
      try {
        await rename(this.lockDirectory, staleDirectory);
        await rm(staleDirectory, { recursive: true, force: true });
      } catch (renameError) {
        if ((renameError as NodeJS.ErrnoException).code !== 'ENOENT') throw renameError;
      }
      return this.acquire();
    }
  }

  async heartbeat(expectedVersion?: number): Promise<RunLeaseRecord> {
    const existing = await this.readOwned();
    if (expectedVersion !== undefined && existing.version !== expectedVersion) {
      throw new Error(`Run lease version conflict: expected ${expectedVersion}, got ${existing.version}.`);
    }
    if (new Date(existing.expiresAt).getTime() <= this.now().getTime()) {
      throw new Error(`Run lease for ${this.runId} expired before heartbeat.`);
    }
    const current = this.now();
    const updated: RunLeaseRecord = {
      ...existing,
      heartbeatAt: current.toISOString(),
      expiresAt: new Date(current.getTime() + this.ttlMs).toISOString(),
      version: existing.version + 1,
    };
    await this.write(updated);
    return updated;
  }

  async release(): Promise<void> {
    const existing = await this.readOwned();
    if (new Date(existing.expiresAt).getTime() <= this.now().getTime()) {
      throw new Error(`Expired run lease ${this.runId} cannot be released by its former owner.`);
    }
    await rm(this.lockDirectory, { recursive: true });
  }

  async inspect(): Promise<RunLeaseRecord> {
    return this.read();
  }

  private async readOwned(): Promise<RunLeaseRecord> {
    const lease = await this.read();
    if (lease.runId !== this.runId || lease.ownerId !== this.ownerId) {
      throw new RunLeaseConflictError(lease);
    }
    return lease;
  }

  private async read(): Promise<RunLeaseRecord> {
    const raw = await readFile(this.leaseFile, 'utf8');
    return JSON.parse(raw) as RunLeaseRecord;
  }

  private async write(lease: RunLeaseRecord): Promise<void> {
    const tempFile = `${this.leaseFile}.${this.ownerId}.tmp`;
    await writeFile(tempFile, `${JSON.stringify(lease, null, 2)}\n`, 'utf8');
    await rename(tempFile, this.leaseFile);
  }
}
