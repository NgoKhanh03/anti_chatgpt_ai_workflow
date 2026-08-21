const baseUrl = (process.env.CHATGPT_AGENT_URL ?? 'http://127.0.0.1:4317').replace(/\/$/, '');

try {
  const response = await fetch(`${baseUrl}/health`);
  const payload = await response.json();
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  console.log(JSON.stringify({
    ok: true,
    agentUrl: baseUrl,
    browserLaunched: false,
    playwright: false,
    ...payload,
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    agentUrl: baseUrl,
    message: 'Persistent browser agent is not running. Start it with: npm run browser:agent',
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exitCode = 1;
}
