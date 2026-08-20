export class AntigravityAdapter {
    transport;
    constructor(transport) {
        this.transport = transport;
    }
    async implement(task) {
        return this.transport.execute({
            mode: 'IMPLEMENT',
            task,
        });
    }
    async fix(task, reviewIssues) {
        return this.transport.execute({
            mode: 'FIX',
            task,
            reviewIssues,
        });
    }
}
