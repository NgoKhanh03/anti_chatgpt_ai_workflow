const VERDICTS = new Set(['APPROVE', 'REQUEST_CHANGES']);
const SEVERITIES = new Set(['P0', 'P1', 'P2', 'P3']);
export class InvalidReviewResponseError extends Error {
    constructor(message) {
        super(message);
        this.name = 'InvalidReviewResponseError';
    }
}
function extractJson(text) {
    const trimmed = text.trim();
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1])
        return fenced[1].trim();
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start)
        return trimmed.slice(start, end + 1);
    throw new InvalidReviewResponseError('Reviewer response does not contain a JSON object.');
}
function requireString(value, field) {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new InvalidReviewResponseError(`${field} must be a non-empty string.`);
    }
    return value;
}
function parseIssue(value, index) {
    if (!value || typeof value !== 'object') {
        throw new InvalidReviewResponseError(`issues[${index}] must be an object.`);
    }
    const issue = value;
    const severity = requireString(issue.severity, `issues[${index}].severity`);
    if (!SEVERITIES.has(severity)) {
        throw new InvalidReviewResponseError(`issues[${index}].severity is invalid.`);
    }
    const result = {
        id: requireString(issue.id, `issues[${index}].id`),
        severity,
        problem: requireString(issue.problem, `issues[${index}].problem`),
    };
    if (typeof issue.file === 'string')
        result.file = issue.file;
    if (typeof issue.line === 'number')
        result.line = issue.line;
    if (typeof issue.evidence === 'string')
        result.evidence = issue.evidence;
    if (typeof issue.recommended_fix === 'string')
        result.recommendedFix = issue.recommended_fix;
    if (typeof issue.recommendedFix === 'string')
        result.recommendedFix = issue.recommendedFix;
    return result;
}
export function parseReviewResponse(text) {
    let parsed;
    try {
        parsed = JSON.parse(extractJson(text));
    }
    catch (error) {
        if (error instanceof InvalidReviewResponseError)
            throw error;
        throw new InvalidReviewResponseError(`Invalid JSON: ${String(error)}`);
    }
    if (!parsed || typeof parsed !== 'object') {
        throw new InvalidReviewResponseError('Review response must be an object.');
    }
    const data = parsed;
    const verdict = requireString(data.verdict, 'verdict');
    if (!VERDICTS.has(verdict)) {
        throw new InvalidReviewResponseError('verdict must be APPROVE or REQUEST_CHANGES.');
    }
    if (!Array.isArray(data.issues)) {
        throw new InvalidReviewResponseError('issues must be an array.');
    }
    const issues = data.issues.map(parseIssue);
    if (verdict === 'APPROVE' && issues.some((issue) => issue.severity === 'P0' || issue.severity === 'P1')) {
        throw new InvalidReviewResponseError('APPROVE cannot contain blocking P0/P1 issues.');
    }
    if (verdict === 'REQUEST_CHANGES' && issues.length === 0) {
        throw new InvalidReviewResponseError('REQUEST_CHANGES requires at least one issue.');
    }
    return { verdict, issues };
}
