import { deterministicChecksPassed } from '../adapters/antigravity/index.js';
import { transition } from './workflow-state.js';
export class CodingCycleCoordinator {
    antigravity;
    constructor(antigravity) {
        this.antigravity = antigravity;
    }
    async implement(task) {
        let state = 'NEW';
        state = transition(state, 'CODING');
        const execution = await this.antigravity.implement(task);
        state = transition(state, 'TESTING');
        if (!deterministicChecksPassed(execution)) {
            state = transition(state, 'FIXING');
        }
        return { state, execution };
    }
    async fix(task, issues) {
        let state = 'FIXING';
        const execution = await this.antigravity.fix(task, issues);
        state = transition(state, 'TESTING');
        if (!deterministicChecksPassed(execution)) {
            state = transition(state, 'FIXING');
        }
        return { state, execution };
    }
}
