export function createInitialState() {
    return {
        state: 'NEW',
        iteration: 0,
        issues: {},
        updatedAt: new Date().toISOString(),
    };
}
