export class BrowserAgentClientTransport {
    baseUrl;
    timeoutMs;
    constructor(options = {}) {
        this.baseUrl = (options.baseUrl ?? 'http://127.0.0.1:4317').replace(/\/$/, '');
        this.timeoutMs = options.timeoutMs ?? 180_000;
    }
    async review(request) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            const response = await fetch(`${this.baseUrl}/review`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(request),
                signal: controller.signal,
            });
            const body = await response.text();
            const payload = (() => {
                try {
                    return JSON.parse(body);
                }
                catch {
                    return null;
                }
            })();
            if (!response.ok || payload?.error) {
                throw new Error(payload?.error ?? `Browser agent returned HTTP ${response.status}`);
            }
            if (typeof payload?.response !== 'string') {
                throw new Error(`Browser agent returned an invalid response payload: ${body.slice(0, 200)}`);
            }
            return payload.response;
        }
        finally {
            clearTimeout(timer);
        }
    }
}
