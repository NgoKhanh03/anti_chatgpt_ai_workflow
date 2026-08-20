import type { AntigravityExecutionResult } from './types.js';

export function deterministicChecksPassed(
  result: AntigravityExecutionResult,
): boolean {
  const { lint, typecheck, tests, build } = result.checks;
  return (
    result.success &&
    lint === 'PASS' &&
    typecheck === 'PASS' &&
    tests === 'PASS' &&
    build === 'PASS'
  );
}

export function hasCommit(result: AntigravityExecutionResult): boolean {
  return typeof result.commitSha === 'string' && result.commitSha.length > 0;
}
