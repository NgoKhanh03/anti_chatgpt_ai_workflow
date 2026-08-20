import http from 'node:http';
import { ChromeCdpChatGptBrowserTransport } from '../adapters/chatgpt/browser-transport.js';
import { ProjectConversationStore } from '../persistence/index.js';
const host = process.env.CHATGPT_AGENT_HOST ?? '127.0.0.1';
const port = Number.parseInt(process.env.CHATGPT_AGENT_PORT ?? '4317', 10);
const conversationStore = new ProjectConversationStore(process.env.CHATGPT_CONVERSATION_STORE ?? '.ai/project-conversations.json');
const transport = new ChromeCdpChatGptBrowserTransport({
    cdpUrl: process.env.CHATGPT_CDP_URL,
    chatUrl: process.env.CHATGPT_URL ?? 'https://chatgpt.com/',
    timeoutMs: Number.parseInt(process.env.CHATGPT_TIMEOUT_MS ?? '300000', 10),
    settleMs: Number.parseInt(process.env.CHATGPT_SETTLE_MS ?? '2500', 10),
    newChatPerReview: (process.env.CHATGPT_NEW_CHAT_PER_REVIEW ?? 'true') === 'true',
    persistentConnection: true,
});
function json(res, status, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(body),
    });
    res.end(body);
}
async function readJson(req) {
    const chunks = [];
    for await (const chunk of req)
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
const server = http.createServer(async (req, res) => {
    try {
        if (req.method === 'GET' && req.url === '/health') {
            json(res, 200, { ok: true, mode: 'persistent-raw-cdp', profile: 'Google Chrome/Profile 2' });
            return;
        }
        if (req.method === 'POST' && req.url === '/review') {
            const request = await readJson(req);
            const projectId = request.projectContext?.projectId;
            const conversationId = request.projectContext?.conversationId ?? (projectId ? await conversationStore.get(projectId) : undefined);
            const result = await transport.reviewWithMetadata({
                ...request,
                projectContext: request.projectContext
                    ? { ...request.projectContext, conversationId }
                    : undefined,
            });
            if (projectId && result.conversationId) {
                await conversationStore.set(projectId, result.conversationId);
            }
            json(res, 200, result);
            return;
        }
        json(res, 404, { error: 'Not found' });
    }
    catch (error) {
        json(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
});
console.log('BROWSER_AGENT_ATTACHING');
console.log('Attach target: existing Google Chrome/Profile 2');
console.log('If Chrome shows an Allow/Confirm dialog, approve it once for this agent session.');
await transport.connect();
console.log('BROWSER_AGENT_CDP_CONNECTED');
server.listen(port, host, () => {
    console.log(`BROWSER_AGENT_READY http://${host}:${port}`);
});
const shutdown = () => {
    server.close(() => {
        transport.close();
        process.exit(0);
    });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
