export const REDACTED = '[REDACTED]';
const SENSITIVE_KEYS = [
    'authorization',
    'apikey',
    'api_key',
    'token',
    'access_token',
    'refresh_token',
    'secret',
    'password',
    'cookie',
];
function isSensitiveKey(key) {
    const normalized = key.toLowerCase().replace(/[-\s]/g, '_');
    return SENSITIVE_KEYS.some((candidate) => normalized.includes(candidate));
}
export function redactString(value) {
    return value
        .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`)
        .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, REDACTED);
}
export function redactValue(value) {
    if (typeof value === 'string')
        return redactString(value);
    if (Array.isArray(value))
        return value.map(redactValue);
    if (!value || typeof value !== 'object')
        return value;
    const result = {};
    for (const [key, entry] of Object.entries(value)) {
        result[key] = isSensitiveKey(key) ? REDACTED : redactValue(entry);
    }
    return result;
}
