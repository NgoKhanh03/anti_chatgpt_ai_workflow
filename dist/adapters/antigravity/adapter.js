import { ScopePolicyError, evaluateScope } from '../../policy/index.js';
export class AntigravityAdapter {
    transport;
    constructor(transport) {
        this.transport = transport;
    }
    async implement(task) {
        const result = await this.transport.execute({
            mode: 'IMPLEMENT',
            task,
        });
        return this.validateScope(task, result);
    }
    async fix(task, reviewIssues) {
        const result = await this.transport.execute({
            mode: 'FIX',
            task,
            reviewIssues,
        });
        return this.validateScope(task, result);
    }
    validateScope(task, result) {
        if (!task.scope)
            return result;
        const evaluation = evaluateScope(task.scope, result.changedFiles, result.scopeExpansionReason);
        if (evaluation.decision !== 'ALLOW')
            throw new ScopePolicyError(evaluation);
        return result;
    }
}
