import { posix } from 'node:path';
const DEFAULT_PROTECTED_PATHS = [
    '.env',
    '.github/workflows/',
    'config/production/',
    'migrations/',
];
function normalizeProjectPath(value) {
    const normalized = posix.normalize(value.replaceAll('\\', '/')).replace(/^\.\//, '');
    if (!normalized || normalized === '..' || normalized.startsWith('../') || posix.isAbsolute(normalized)) {
        throw new Error(`Invalid project-relative path: ${value}`);
    }
    return normalized;
}
function matchesPath(path, rule) {
    const normalizedRule = normalizeProjectPath(rule);
    return normalizedRule.endsWith('/')
        ? path.startsWith(normalizedRule)
        : path === normalizedRule;
}
export function evaluateScope(policy, changedFiles, scopeExpansionReason) {
    const expected = new Set(policy.expectedFiles.map(normalizeProjectPath));
    const roots = policy.allowedWriteRoots.map(normalizeProjectPath);
    const protectedPaths = [...DEFAULT_PROTECTED_PATHS, ...(policy.protectedPaths ?? [])];
    const violations = [];
    const expandedFiles = [];
    for (const value of changedFiles) {
        let path;
        try {
            path = normalizeProjectPath(value);
        }
        catch (error) {
            violations.push(error instanceof Error ? error.message : String(error));
            continue;
        }
        if (protectedPaths.some((rule) => matchesPath(path, rule))) {
            violations.push(`Protected path changed: ${path}`);
            continue;
        }
        if (!roots.some((root) => matchesPath(path, root))) {
            violations.push(`File is outside allowed write roots: ${path}`);
            continue;
        }
        if (!expected.has(path))
            expandedFiles.push(path);
    }
    if (violations.length > 0)
        return { decision: 'DENY', violations, expandedFiles };
    if (expandedFiles.length === 0)
        return { decision: 'ALLOW', violations, expandedFiles };
    const hasReason = typeof scopeExpansionReason === 'string' && scopeExpansionReason.trim().length > 0;
    if (policy.allowReasonedExpansion && hasReason) {
        return { decision: 'ALLOW', violations, expandedFiles };
    }
    return {
        decision: 'NEEDS_HUMAN',
        violations: ['Scope expanded beyond expected files without an approved expansion policy.'],
        expandedFiles,
    };
}
export function evaluateOperation(policy, intent) {
    const violations = [];
    if (!policy.allowedKinds.includes(intent.kind))
        violations.push(`Operation kind is not allowed: ${intent.kind}`);
    if (intent.destructive)
        violations.push(`Destructive operation requires human approval: ${intent.kind}`);
    if (intent.readsSecrets)
        violations.push(`Secret access requires human approval: ${intent.kind}`);
    if (intent.externalSideEffect && !policy.allowExternalSideEffects) {
        violations.push(`External side effect requires human approval: ${intent.kind}`);
    }
    return {
        decision: violations.length > 0 ? 'NEEDS_HUMAN' : 'ALLOW',
        violations,
        expandedFiles: [],
    };
}
export class ScopePolicyError extends Error {
    evaluation;
    constructor(evaluation) {
        super(`Scope policy decision ${evaluation.decision}: ${evaluation.violations.join('; ')}`);
        this.evaluation = evaluation;
        this.name = 'ScopePolicyError';
    }
}
