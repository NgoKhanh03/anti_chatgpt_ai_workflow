import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ReviewIssue } from '../adapters/chatgpt/index.js';

export type TechnicalDebtStatus = 'OPEN' | 'ACCEPTED' | 'RESOLVED' | 'WONT_FIX';

export interface TechnicalDebtRecord {
  id: string;
  fingerprint: string;
  severity: 'P2' | 'P3';
  problem: string;
  file?: string;
  line?: number;
  evidence?: string;
  sourcePhaseId: string;
  sourceUnitId: string;
  status: TechnicalDebtStatus;
  owner?: string;
  duePhaseId?: string;
  dispositionReason?: string;
  resolution?: string;
  occurrences: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

interface TechnicalDebtFile {
  version: 1;
  records: Record<string, TechnicalDebtRecord>;
}

export interface DebtGatePolicy {
  requireDispositionAtPhaseGate: boolean;
  requireResolutionAtFinal: Array<'P2' | 'P3'>;
}

export interface DebtGateResult {
  allowed: boolean;
  blocking: TechnicalDebtRecord[];
}

function fingerprint(issue: ReviewIssue): string {
  const normalized = [issue.file ?? '', issue.problem.trim().toLowerCase().replace(/\s+/g, ' ')].join('\0');
  return createHash('sha256').update(normalized).digest('hex');
}

export class TechnicalDebtStore {
  constructor(private readonly filePath: string) {}

  async sync(
    issues: ReviewIssue[],
    source: { phaseId: string; unitId: string },
  ): Promise<TechnicalDebtRecord[]> {
    const file = await this.read();
    const now = new Date().toISOString();
    const updated: TechnicalDebtRecord[] = [];

    for (const issue of issues.filter((candidate) => candidate.severity === 'P2' || candidate.severity === 'P3')) {
      const issueFingerprint = fingerprint(issue);
      const existing = Object.values(file.records).find((record) => record.fingerprint === issueFingerprint);
      const record: TechnicalDebtRecord = existing
        ? {
            ...existing,
            severity: issue.severity as 'P2' | 'P3',
            problem: issue.problem,
            file: issue.file,
            line: issue.line,
            evidence: issue.evidence,
            status: existing.status === 'RESOLVED' ? 'OPEN' : existing.status,
            resolution: existing.status === 'RESOLVED' ? undefined : existing.resolution,
            occurrences: existing.occurrences + 1,
            lastSeenAt: now,
          }
        : {
            id: `TD-${issueFingerprint.slice(0, 12).toUpperCase()}`,
            fingerprint: issueFingerprint,
            severity: issue.severity as 'P2' | 'P3',
            problem: issue.problem,
            file: issue.file,
            line: issue.line,
            evidence: issue.evidence,
            sourcePhaseId: source.phaseId,
            sourceUnitId: source.unitId,
            status: 'OPEN',
            occurrences: 1,
            firstSeenAt: now,
            lastSeenAt: now,
          };
      file.records[record.id] = record;
      updated.push(record);
    }

    await this.write(file);
    return updated;
  }

  async accept(
    id: string,
    owner: string,
    reason: string,
    duePhaseId?: string,
  ): Promise<TechnicalDebtRecord> {
    if (!owner.trim() || !reason.trim()) throw new Error('Accepted debt requires owner and reason.');
    return this.update(id, (record) => ({
      ...record,
      status: 'ACCEPTED',
      owner,
      duePhaseId,
      dispositionReason: reason,
    }));
  }

  async resolve(id: string, resolution: string): Promise<TechnicalDebtRecord> {
    if (!resolution.trim()) throw new Error('Resolved debt requires a resolution.');
    return this.update(id, (record) => ({ ...record, status: 'RESOLVED', resolution }));
  }

  async wontFix(id: string, owner: string, reason: string): Promise<TechnicalDebtRecord> {
    if (!owner.trim() || !reason.trim()) throw new Error('WONT_FIX debt requires owner and reason.');
    return this.update(id, (record) => ({
      ...record,
      status: 'WONT_FIX',
      owner,
      dispositionReason: reason,
    }));
  }

  async list(): Promise<TechnicalDebtRecord[]> {
    return Object.values((await this.read()).records);
  }

  async evaluateGate(
    gate: 'PHASE' | 'FINAL',
    policy: DebtGatePolicy,
  ): Promise<DebtGateResult> {
    const records = await this.list();
    const blocking = records.filter((record) => {
      if (record.status === 'RESOLVED' || record.status === 'WONT_FIX') return false;
      if (gate === 'PHASE') return policy.requireDispositionAtPhaseGate && record.status === 'OPEN';
      return record.status === 'OPEN' || policy.requireResolutionAtFinal.includes(record.severity);
    });
    return { allowed: blocking.length === 0, blocking };
  }

  private async read(): Promise<TechnicalDebtFile> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as TechnicalDebtFile;
      if (parsed.version !== 1 || !parsed.records || typeof parsed.records !== 'object') {
        throw new Error('Unsupported technical debt store format.');
      }
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, records: {} };
      throw error;
    }
  }

  private async write(file: TechnicalDebtFile): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
    await rename(tempPath, this.filePath);
  }

  private async update(
    id: string,
    mutate: (record: TechnicalDebtRecord) => TechnicalDebtRecord,
  ): Promise<TechnicalDebtRecord> {
    const file = await this.read();
    const existing = file.records[id];
    if (!existing) throw new Error(`Technical debt record ${id} does not exist.`);
    const updated = mutate(existing);
    file.records[id] = updated;
    await this.write(file);
    return updated;
  }
}
