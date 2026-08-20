export class UnconfiguredBrowserTransport {
    async review() {
        throw new Error('ChatGPT browser transport is not configured. Provide a browser automation implementation.');
    }
}
