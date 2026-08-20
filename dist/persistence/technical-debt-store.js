import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
function fingerprint(issue) {
    const normalized = [issue.file ?? '', issue.problem.trim().toLowerCase().replace(/\s+/g, ' ')].join('\0');
    return createHash('sha256').update(normalized).digest('hex');
}
export class TechnicalDebtStore {
    filePath;
    constructor(filePath) {
        this.filePath = filePath;
    }
    async sync(issues, source) {
        const file = await this.read();
        const now = new Date().toISOString();
        const updated = [];
        for (const issue of issues.filter((candidate) => candidate.severity === 'P2' || candidate.severity === 'P3')) {
            const issueFingerprint = fingerprint(issue);
            const existing = Object.values(file.records).find((record) => record.fingerprint === issueFingerprint);
            const record = existing
                ? {
                    ...existing,
                    severity: issue.severity,
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
                    severity: issue.severity,
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
    async accept(id, owner, reason, duePhaseId) {
        if (!owner.trim() || !reason.trim())
            throw new Error('Accepted debt requires owner and reason.');
        return this.update(id, (record) => ({
            ...record,
            status: 'ACCEPTED',
            owner,
            duePhaseId,
            dispositionReason: reason,
        }));
    }
    async resolve(id, resolution) {
        if (!resolution.trim())
            throw new Error('Resolved debt requires a resolution.');
        return this.update(id, (record) => ({ ...record, status: 'RESOLVED', resolution }));
    }
    async wontFix(id, owner, reason) {
        if (!owner.trim() || !reason.trim())
            throw new Error('WONT_FIX debt requires owner and reason.');
        return this.update(id, (record) => ({
            ...record,
            status: 'WONT_FIX',
            owner,
            dispositionReason: reason,
        }));
    }
    async list() {
        return Object.values((await this.read()).records);
    }
    async evaluateGate(gate, policy) {
        const records = await this.list();
        const blocking = records.filter((record) => {
            if (record.status === 'RESOLVED' || record.status === 'WONT_FIX')
                return false;
            if (gate === 'PHASE')
                return policy.requireDispositionAtPhaseGate && record.status === 'OPEN';
            return record.status === 'OPEN' || policy.requireResolutionAtFinal.includes(record.severity);
        });
        return { allowed: blocking.length === 0, blocking };
    }
    async read() {
        try {
            const raw = await readFile(this.filePath, 'utf8');
            const parsed = JSON.parse(raw);
            if (parsed.version !== 1 || !parsed.records || typeof parsed.records !== 'object') {
                throw new Error('Unsupported technical debt store format.');
            }
            return parsed;
        }
        catch (error) {
            if (error.code === 'ENOENT')
                return { version: 1, records: {} };
            throw error;
        }
    }
    async write(file) {
        await mkdir(dirname(this.filePath), { recursive: true });
        const tempPath = `${this.filePath}.tmp`;
        await writeFile(tempPath, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
        await rename(tempPath, this.filePath);
    }
    async update(id, mutate) {
        const file = await this.read();
        const existing = file.records[id];
        if (!existing)
            throw new Error(`Technical debt record ${id} does not exist.`);
        const updated = mutate(existing);
        file.records[id] = updated;
        await this.write(file);
        return updated;
    }
}
