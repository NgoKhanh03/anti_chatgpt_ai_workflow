import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { BrowserAgentClientTransport } from '../dist/adapters/chatgpt/index.js';

test('browser agent client forwards review request to persistent agent', async () => {
  let received;
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    received = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ response: '{"verdict":"APPROVE","issues":[]}' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const transport = new BrowserAgentClientTransport({ baseUrl: `http://127.0.0.1:${address.port}`, timeoutMs: 5000 });
  const request = { systemPrompt: 'review', handoff: {}, handoffMarkdown: '# handoff' };
  const result = await transport.review(request);
  assert.equal(result, '{"verdict":"APPROVE","issues":[]}');
  assert.equal(received.systemPrompt, 'review');
  server.close();
});

test('browser agent client rejects a streamed error payload', async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json', 'transfer-encoding': 'chunked' });
    res.flushHeaders();
    res.end(JSON.stringify({ error: 'review failed after headers were sent' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    const transport = new BrowserAgentClientTransport({ baseUrl: `http://127.0.0.1:${address.port}`, timeoutMs: 5000 });
    await assert.rejects(
      () => transport.review({ systemPrompt: 'review', handoff: {}, handoffMarkdown: '# handoff' }),
      /review failed after headers were sent/,
    );
  } finally {
    server.close();
  }
});
