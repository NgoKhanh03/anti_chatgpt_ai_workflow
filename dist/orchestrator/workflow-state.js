export const WORKFLOW_STATES = [
    'NEW',
    'CODING',
    'TESTING',
    'FIXING',
    'PR_CREATED',
    'AI_REVIEWING',
    'FINAL_REVIEW',
    'AI_APPROVED',
    'HUMAN_APPROVAL',
    'NEEDS_HUMAN',
    'MERGED',
];
export const ALLOWED_TRANSITIONS = {
    NEW: ['CODING', 'NEEDS_HUMAN'],
    CODING: ['TESTING', 'NEEDS_HUMAN'],
    TESTING: ['FIXING', 'PR_CREATED', 'NEEDS_HUMAN'],
    FIXING: ['TESTING', 'NEEDS_HUMAN'],
    PR_CREATED: ['AI_REVIEWING', 'NEEDS_HUMAN'],
    AI_REVIEWING: ['FIXING', 'FINAL_REVIEW', 'NEEDS_HUMAN'],
    FINAL_REVIEW: ['FIXING', 'AI_APPROVED', 'NEEDS_HUMAN'],
    AI_APPROVED: ['HUMAN_APPROVAL', 'NEEDS_HUMAN'],
    HUMAN_APPROVAL: ['MERGED', 'NEEDS_HUMAN'],
    NEEDS_HUMAN: ['CODING', 'FIXING', 'AI_REVIEWING', 'FINAL_REVIEW', 'HUMAN_APPROVAL'],
    MERGED: [],
};
export class InvalidTransitionError extends Error {
    constructor(current, next) {
        super(`Invalid workflow transition: ${current} -> ${next}`);
        this.name = 'InvalidTransitionError';
    }
}
export function canTransition(current, next) {
    return ALLOWED_TRANSITIONS[current].includes(next);
}
export function transition(current, next) {
    if (!canTransition(current, next)) {
        throw new InvalidTransitionError(current, next);
    }
    return next;
}
export function isTerminalState(state) {
    return state === 'MERGED';
}
