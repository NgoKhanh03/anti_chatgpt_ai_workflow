export function deterministicChecksPassed(result) {
    const { lint, typecheck, tests, build } = result.checks;
    return (result.success &&
        lint === 'PASS' &&
        typecheck === 'PASS' &&
        tests === 'PASS' &&
        build === 'PASS');
}
export function hasCommit(result) {
    return typeof result.commitSha === 'string' && result.commitSha.length > 0;
}
