# Bug Fix History

Tài liệu này lưu lại lịch sử các bug đã phát hiện và sửa trong AI Workflow, đặc biệt ở luồng:

```text
Antigravity -> PR -> CI -> ChatGPT Browser Reviewer -> Review Contract
```

Mục tiêu của tài liệu là giữ lại **lý do thay đổi code**, không chỉ trạng thái cuối cùng. Mỗi bug gồm:

- Triệu chứng
- Nguyên nhân gốc
- Code trước khi sửa
- Code sau khi sửa
- Files affected
- Cách verify

> Project root: `/Users/dp_macbook_07/Documents/ai_workflow`
>
> Browser strategy hiện tại: existing Google Chrome / Profile 2 / raw CDP / persistent browser agent.

---

## BUG-001 — Reviewer mở Chrome/profile riêng thay vì dùng Chrome Profile 2 hiện hữu

### Triệu chứng

Browser reviewer ban đầu dùng Playwright/dedicated Chrome profile và remote debugging port riêng.

Điều này tạo một Chrome/profile trắng, không dùng session ChatGPT đang đăng nhập trong Chrome Profile 2.

### Yêu cầu đúng

Reviewer phải:

```text
Existing Google Chrome
  -> Profile 2
  -> existing authenticated ChatGPT session
  -> raw CDP
```

Không được:

```text
Playwright
  -> launch new Chrome
  -> custom blank user-data-dir
```

### Nguyên nhân gốc

Kiến trúc transport ban đầu coi browser reviewer như một browser automation độc lập, thay vì attach vào browser session thật đang chạy.

### Code/config trước khi sửa

Ví dụ kiến trúc cũ:

```text
playwright-core
--remote-debugging-port=9333
--user-data-dir=/Users/dp_macbook_07/.ai-workflow-chrome
```

Package/script cũ có dạng:

```json
{
  "scripts": {
    "browser:launch": "..."
  }
}
```

### Code/config sau khi sửa

Transport được đổi sang raw Chrome DevTools Protocol và đọc browser WebSocket từ Chrome thật:

```ts
function defaultDevToolsActivePortFile(): string {
  return path.join(
    os.homedir(),
    'Library/Application Support/Google/Chrome/DevToolsActivePort',
  );
}
```

```ts
export function resolveBrowserWebSocketUrl(options: ChatGptBrowserOptions = {}): string {
  if (options.cdpUrl?.startsWith('ws://') || options.cdpUrl?.startsWith('wss://')) {
    return options.cdpUrl;
  }

  const file = options.devToolsActivePortFile ?? defaultDevToolsActivePortFile();
  const [port, browserPath] = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
  return `ws://127.0.0.1:${port}${browserPath}`;
}
```

Removed:

```text
playwright-core
browser:launch
.ai-workflow-chrome
port 9333 dependency
```

### Files affected

```text
src/adapters/chatgpt/browser-transport.ts
src/adapters/reviewer/config.ts
src/adapters/reviewer/factory.ts
src/cli/browser-check.ts
config/reviewer.example.env
package.json
package-lock.json
```

### Verification

```bash
npm test
npm run typecheck
npm run build
npm run browser:check
```

Expected browser check:

```json
{
  "ok": true,
  "browserLaunched": false,
  "playwright": false,
  "profile": "Google Chrome/Profile 2 (existing Chrome session)"
}
```

---

## BUG-002 — Chrome `/json/version` và `/json/list` trả 404

### Triệu chứng

Chrome đang listen ở port remote debugging, nhưng các HTTP discovery endpoints như:

```text
/json/version
/json/list
/json
```

trả HTTP 404.

### Nguyên nhân gốc

Không thể phụ thuộc vào HTTP discovery endpoints của Chrome trong session này.

Tuy nhiên Chrome vẫn ghi browser-level DevTools WebSocket vào:

```text
~/Library/Application Support/Google/Chrome/DevToolsActivePort
```

### Code trước khi sửa

Kiến trúc discovery giả định có thể lấy WebSocket thông qua HTTP endpoint.

```ts
// conceptual old approach
const version = await fetch('http://127.0.0.1:9222/json/version');
const { webSocketDebuggerUrl } = await version.json();
```

### Code sau khi sửa

Đọc trực tiếp file `DevToolsActivePort`:

```ts
const [port, browserPath] = fs
  .readFileSync(devToolsActivePortFile, 'utf8')
  .trim()
  .split(/\r?\n/);

return `ws://127.0.0.1:${port}${browserPath}`;
```

Ví dụ file thực tế:

```text
9222
/devtools/browser/<browser-id>
```

### Files affected

```text
src/adapters/chatgpt/browser-transport.ts
src/cli/browser-check.ts
```

### Verification

Raw CDP đã gọi thành công:

```text
Target.getTargets
Target.attachToTarget
Runtime.enable
Runtime.evaluate
```

và đọc được các ChatGPT tabs authenticated trong cùng Chrome Profile 2.

---

## BUG-003 — `Target.createTarget(browserContextId)` fail với Chrome user profile thật

### Triệu chứng

Live smoke fail:

```text
Error: {
  "code": -32000,
  "message": "Failed to find browser context with id A3C564AFA42C27EE17AB492E842F8AFD"
}
```

Trong khi `Target.getTargets` vẫn trả cùng `browserContextId` cho các tab ChatGPT của Profile 2.

### Nguyên nhân gốc

`Target.createTarget({ browserContextId })` không hoạt động ổn định với normal user profile context của Chrome đang chạy.

Browser context ID nhìn thấy từ target không đồng nghĩa với việc browser-level API cho phép tạo target trực tiếp vào context đó.

### Code trước khi sửa

```ts
const created = await client.send('Target.createTarget', {
  url: this.options.chatUrl,
  browserContextId: anchorTarget.browserContextId,
  newWindow: false,
  background: false,
});
```

### Code sau khi sửa

Mở New Chat từ chính một ChatGPT tab đã authenticated:

```ts
const { sessionId: anchorSessionId } = await client.send(
  'Target.attachToTarget',
  {
    targetId: anchorTarget.targetId,
    flatten: true,
  },
);

await client.send('Runtime.enable', {}, anchorSessionId);

const openResult = await client.send(
  'Runtime.evaluate',
  {
    expression: `window.open(${JSON.stringify(this.options.chatUrl)}, '_blank') !== null`,
    returnByValue: true,
    userGesture: true,
  },
  anchorSessionId,
);
```

Sau đó detect target mới:

```ts
const existingTargetIds = new Set(
  (targetInfos ?? []).map((t: any) => t.targetId),
);

createdTarget = (current.targetInfos ?? []).find((candidate: any) =>
  candidate.type === 'page' &&
  !existingTargetIds.has(candidate.targetId) &&
  String(candidate.url ?? '').includes('chatgpt.com') &&
  (!anchorTarget.browserContextId ||
    candidate.browserContextId === anchorTarget.browserContextId)
);
```

### Tại sao fix này đúng

`window.open()` chạy từ page đã authenticated nên tab mới inherit:

```text
Profile 2 cookies
ChatGPT login session
same Chrome process
same user profile
```

Không cần tạo Chrome context mới.

### Files affected

```text
src/adapters/chatgpt/browser-transport.ts
```

### Verification

New Chat target được tạo với:

```text
url: https://chatgpt.com/
authenticated: true
composer: #prompt-textarea
browserContextId: same as existing Profile 2 tabs
```

---

## BUG-004 — New Chat được tạo nhưng reviewer kiểm tra composer quá sớm

### Triệu chứng

Live smoke fail:

```text
ChatGPT composer was not found in the existing Chrome tab.
```

Diagnostic ngay sau đó lại cho thấy target mới hoàn toàn bình thường:

```text
readyState: complete
composer: #prompt-textarea
authenticated: true
```

### Nguyên nhân gốc

Code chỉ chờ:

```ts
document.readyState === 'complete' ||
document.readyState === 'interactive'
```

Nhưng ChatGPT là SPA. `document.readyState` hoàn thành không có nghĩa React/UI đã mount composer và auth state đã sẵn sàng.

### Code trước khi sửa

```ts
while (Date.now() < pageReadyDeadline) {
  const ready = await client.send('Runtime.evaluate', {
    expression:
      `document.readyState === 'complete' || ` +
      `document.readyState === 'interactive'`,
    returnByValue: true,
  }, sessionId);

  if (ready.result?.value) break;
}

const readiness = await client.send('Runtime.evaluate', {
  expression: `(() => {
    const composer = document.querySelector('#prompt-textarea');
    return { ready: !!composer };
  })()`,
  returnByValue: true,
}, sessionId);
```

### Code sau khi sửa

Poll trực tiếp cho tới khi composer **visible và authenticated**:

```ts
const pageReadyDeadline =
  Date.now() + Math.min(this.options.timeoutMs, 30_000);

let state: any = null;

while (Date.now() < pageReadyDeadline) {
  const readiness = await client.send('Runtime.evaluate', {
    expression: `(() => {
      const text = document.body?.innerText || '';
      const composer =
        document.querySelector('#prompt-textarea') ||
        document.querySelector('#mobile-composer-prompt') ||
        document.querySelector('textarea[aria-label="Chat with ChatGPT"]') ||
        document.querySelector('textarea[placeholder="Ask anything"]') ||
        document.querySelector('[contenteditable="true"][data-lexical-editor="true"]');

      const visible = !!composer && !!(
        composer.offsetWidth ||
        composer.offsetHeight ||
        composer.getClientRects().length
      );

      const loggedOut =
        /Log in to get answers based on saved chats/i.test(text) ||
        [...document.querySelectorAll('button,a')]
          .some(el => (el.innerText || '').trim() === 'Log in');

      return {
        readyState: document.readyState,
        ready: visible,
        authenticated: !loggedOut,
        href: location.href,
        title: document.title,
      };
    })()`,
    returnByValue: true,
  }, sessionId).catch(() => ({ result: { value: null } }));

  state = readiness.result?.value ?? null;
  if (state?.ready && state?.authenticated) break;

  await new Promise(resolve => setTimeout(resolve, 300));
}
```

### Files affected

```text
src/adapters/chatgpt/browser-transport.ts
```

### Verification

Live smoke vượt qua readiness và đi tới bước ChatGPT trả response.

---

## BUG-005 — ChatGPT trả JSON nhìn đúng nhưng `JSON.parse` fail vì quote không escape

### Triệu chứng

Parser fail:

```text
InvalidReviewResponseError:
Invalid JSON: SyntaxError:
Expected ',' or '}' after property value in JSON
```

Raw response chứa:

```json
{
  "problem": "The PR handoff metadata states "Files Changed - None", but the supplied diff adds sum.ts."
}
```

Quote bên trong string không được escape nên JSON invalid.

### Nguyên nhân gốc

Prompt chỉ nói:

```text
Return the Review Contract JSON only.
```

Model hiểu yêu cầu về shape, nhưng không được nhấn mạnh rằng output phải pass strict `JSON.parse`.

Ngoài ra smoke handoff lúc đó không nhất quán:

```text
Files Changed: None
```

trong khi diff lại add `sum.ts`, khiến model phải mô tả conflict và chèn quote trong text.

### Code trước khi sửa

```ts
return `${systemPrompt}

--- PR HANDOFF ---
${handoffMarkdown}

Return the Review Contract JSON only.`;
```

Smoke fixture:

```ts
diff: {
  patch: `... sum.ts ...`,
  files: [],
}
```

### Code sau khi sửa

Prompt được harden:

```ts
return `${systemPrompt}

--- PR HANDOFF ---
${handoffMarkdown}

Return the Review Contract JSON only. The response MUST be syntactically valid JSON parseable by JSON.parse. Escape every double quote that appears inside a JSON string value. Do not use Markdown fences, comments, trailing commas, or any text before or after the JSON object.`;
```

Smoke fixture được làm nhất quán:

```ts
diff: {
  patch: `... sum.ts ...`,
  files: [
    {
      path: 'sum.ts',
      additions: 3,
      deletions: 0,
      status: 'added',
    },
  ],
}
```

### Files affected

```text
src/adapters/chatgpt/browser-transport.ts
src/cli/live-smoke-review.ts
```

### Verification

Live smoke trả thành công:

```json
{
  "verdict": "APPROVE",
  "issues": []
}
```

---

## BUG-006 — Mỗi smoke test đều yêu cầu Chrome Confirm/Allow lại

### Triệu chứng

Mỗi lần chạy:

```bash
npm run browser:smoke
```

Chrome lại hiện Confirm/Allow cho remote debugging.

### Nguyên nhân gốc

Transport cũ tạo một raw CDP WebSocket mới trong mỗi `review()` và đóng nó ở cuối request.

Flow cũ:

```text
browser:smoke
  -> new RawCdpClient
  -> connect Chrome
  -> Confirm
  -> review
  -> client.close()
```

Review tiếp theo lại reconnect từ đầu.

### Code trước khi sửa

```ts
async review(request: ChatGptReviewRequest): Promise<string> {
  const client = new RawCdpClient();
  const wsUrl = resolveBrowserWebSocketUrl(this.options);

  await client.connect(
    wsUrl,
    Math.min(this.options.timeoutMs, 10_000),
  );

  try {
    // review
  } finally {
    client.close();
  }
}
```

### Code sau khi sửa

Thêm persistent connection support:

```ts
private persistentClient?: RawCdpClient;
```

```ts
private async createClient(): Promise<RawCdpClient> {
  const client = new RawCdpClient();
  const wsUrl = resolveBrowserWebSocketUrl(this.options);

  await client.connect(
    wsUrl,
    Math.min(this.options.timeoutMs, 10_000),
  );

  return client;
}
```

```ts
async connect(): Promise<void> {
  if (this.persistentClient?.isOpen()) return;

  this.persistentClient?.close();
  this.persistentClient = await this.createClient();
}
```

```ts
private async acquireClient(): Promise<RawCdpClient> {
  if (this.options.persistentConnection) {
    await this.connect();

    if (!this.persistentClient) {
      throw new Error('Persistent CDP client was not initialized.');
    }

    return this.persistentClient;
  }

  return this.createClient();
}
```

Và agent local được thêm:

```text
npm run browser:agent
```

Agent giữ CDP WebSocket sống và expose:

```text
GET  /health
POST /review
```

Browser reviewer chính gọi HTTP localhost thay vì reconnect Chrome trực tiếp.

### Browser agent client

```ts
export class BrowserAgentClientTransport implements ReviewerTransport {
  async review(request: ChatGptReviewRequest): Promise<string> {
    const response = await fetch(`${this.baseUrl}/review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    });

    const payload = await response.json();
    return payload.response;
  }
}
```

### Files affected

```text
src/adapters/chatgpt/browser-agent-client.ts
src/adapters/chatgpt/browser-transport.ts
src/cli/browser-agent.ts
src/cli/browser-check.ts
src/adapters/reviewer/config.ts
src/adapters/reviewer/factory.ts
src/adapters/chatgpt/index.ts
config/reviewer.example.env
package.json
tests/browser-agent-client.test.mjs
```

### New runtime architecture

```text
Chrome Profile 2
      |
      | Confirm once
      v
browser:agent
      |
      | persistent browser-level CDP WebSocket
      |
      +--> smoke #1
      +--> smoke #2
      +--> PR review
      +--> re-review
      +--> clean-room review
```

### Verification

```text
34/34 tests PASS
browser:check -> ok
smoke #1 -> PASS
agent health -> still ok
smoke #2 -> PASS
agent health -> still ok
```

---

## BUG-007 — Persistent agent bị `Maximum call stack size exceeded`

### Triệu chứng

Khi start:

```bash
npm run browser:agent
```

process crash:

```text
RangeError: Maximum call stack size exceeded
```

Stack trace lặp:

```text
connect()
  -> acquireClient()
      -> connect()
          -> acquireClient()
              -> ...
```

### Nguyên nhân gốc

Implementation đầu tiên của persistent client có circular recursion.

### Code lỗi

```ts
async connect(): Promise<void> {
  if (this.persistentClient?.isOpen()) return;

  const client = await this.acquireClient();
  this.persistentClient = client;
}
```

```ts
private async acquireClient(): Promise<RawCdpClient> {
  if (this.options.persistentConnection) {
    await this.connect();
    return this.persistentClient!;
  }

  const client = await this.acquireClient();
  return client;
}
```

Cả hai nhánh đều có thể gọi ngược chính nó.

### Code sau khi sửa

Tách primitive `createClient()` không phụ thuộc persistent mode:

```ts
private async createClient(): Promise<RawCdpClient> {
  const client = new RawCdpClient();
  const wsUrl = resolveBrowserWebSocketUrl(this.options);

  await client.connect(
    wsUrl,
    Math.min(this.options.timeoutMs, 10_000),
  );

  return client;
}
```

```ts
async connect(): Promise<void> {
  if (this.persistentClient?.isOpen()) return;

  this.persistentClient?.close();
  this.persistentClient = await this.createClient();
}
```

```ts
private async acquireClient(): Promise<RawCdpClient> {
  if (this.options.persistentConnection) {
    await this.connect();

    if (!this.persistentClient) {
      throw new Error('Persistent CDP client was not initialized.');
    }

    return this.persistentClient;
  }

  return this.createClient();
}
```

### Files affected

```text
src/adapters/chatgpt/browser-transport.ts
```

### Verification

```bash
npm test
npm run typecheck
npm run build
npm run browser:agent
```

Expected:

```text
BROWSER_AGENT_ATTACHING
BROWSER_AGENT_CDP_CONNECTED
BROWSER_AGENT_READY http://127.0.0.1:4317
```

---

## BUG-008 — Smoke thứ hai trên persistent agent fail `Promise was collected`

### Triệu chứng

Smoke đầu tiên:

```text
PASS
```

Smoke thứ hai trên cùng persistent CDP connection fail:

```text
Error: {
  "code": -32000,
  "message": "Promise was collected"
}
```

Agent vẫn health:

```json
{
  "ok": true,
  "mode": "persistent-raw-cdp"
}
```

### Nguyên nhân gốc

Prompt submit dùng một async IIFE trong `Runtime.evaluate`:

```ts
expression: `(async () => {
  ...
  await sleep(300);
  ...
})()`,
awaitPromise: true,
```

Khi execution context/page lifecycle thay đổi, Chrome có thể collect Promise object trước khi CDP nhận completion.

Ngoài ra review target session chưa được detach rõ ràng sau mỗi review.

### Code trước khi sửa

```ts
const submit = await client.send('Runtime.evaluate', {
  expression: `(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    // fill composer

    await sleep(300);

    // click Send
  })()`,
  returnByValue: true,
  awaitPromise: true,
}, sessionId);
```

### Code sau khi sửa — phase 1: fill synchronously

```ts
const fill = await client.send('Runtime.evaluate', {
  expression: `(() => {
    const el =
      document.querySelector('#prompt-textarea') ||
      document.querySelector('#mobile-composer-prompt') ||
      document.querySelector('textarea[aria-label="Chat with ChatGPT"]') ||
      document.querySelector('textarea[placeholder="Ask anything"]') ||
      document.querySelector('[contenteditable="true"][data-lexical-editor="true"]');

    if (!el) return { ok: false, reason: 'NO_COMPOSER' };

    el.focus();
    const value = ${encoded};

    if (el instanceof HTMLTextAreaElement) {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;

      setter?.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      const sel = window.getSelection();
      const range = document.createRange();

      range.selectNodeContents(el);
      sel?.removeAllRanges();
      sel?.addRange(range);

      document.execCommand('insertText', false, value);
      el.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText',
        data: value,
      }));
    }

    return { ok: true };
  })()`,
  returnByValue: true,
}, sessionId);
```

### Code sau khi sửa — phase 2: delay ở Node side

```ts
await new Promise(resolve => setTimeout(resolve, 300));
```

Không còn:

```ts
awaitPromise: true
```

### Code sau khi sửa — phase 3: submit synchronously

```ts
const submit = await client.send('Runtime.evaluate', {
  expression: `(() => {
    const sendButton =
      document.querySelector('button[data-testid="send-button"]') ||
      document.querySelector('button[aria-label="Send message"]') ||
      [...document.querySelectorAll('button')]
        .find(b => /send message/i.test(
          b.getAttribute('aria-label') || ''
        ));

    if (sendButton && !sendButton.disabled) {
      sendButton.click();
      return { ok: true, method: 'button' };
    }

    // keyboard fallback
    return { ok: true, method: 'enter' };
  })()`,
  returnByValue: true,
}, sessionId);
```

### Code sau khi sửa — phase 4: detach per-review page session

```ts
let reviewSessionId: string | undefined;
```

Sau attach:

```ts
const { sessionId } = await client.send('Target.attachToTarget', {
  targetId: target.targetId,
  flatten: true,
});

reviewSessionId = sessionId;
```

Trong `finally`:

```ts
finally {
  if (reviewSessionId) {
    await client.send(
      'Target.detachFromTarget',
      { sessionId: reviewSessionId },
    ).catch(() => {});
  }

  if (!this.options.persistentConnection) {
    client.close();
  }
}
```

Điểm quan trọng:

```text
page target session   -> tạo/detach cho từng review
browser CDP websocket -> giữ persistent
```

### Files affected

```text
src/adapters/chatgpt/browser-transport.ts
```

### Verification

Hai smoke liên tiếp trên cùng agent:

```text
=== SMOKE #1 ===
LIVE_SMOKE_RESULT
{
  "verdict": "APPROVE",
  "issues": [...]
}

=== SMOKE #2 ===
LIVE_SMOKE_RESULT
{
  "verdict": "APPROVE",
  "issues": []
}
```

Health trước/giữa/sau:

```json
{
  "ok": true,
  "mode": "persistent-raw-cdp",
  "profile": "Google Chrome/Profile 2"
}
```

---

# Current Stable Architecture

Sau toàn bộ các bug fix trên, browser reviewer hiện có kiến trúc:

```text
                         +-----------------------+
                         | Existing Google Chrome|
                         | Profile 2             |
                         | ChatGPT authenticated |
                         +-----------+-----------+
                                     |
                                     | raw CDP
                                     | confirm once/session
                                     v
                         +-----------------------+
                         | browser:agent         |
                         | 127.0.0.1:4317        |
                         | persistent WebSocket  |
                         +-----------+-----------+
                                     |
                   +-----------------+------------------+
                   |                 |                  |
                   v                 v                  v
             review #1          review #2        clean-room review
                   |                 |                  |
                   +-----------------+------------------+
                                     |
                                     v
                             New Chat per review
                                     |
                                     v
                              JSON Review Contract
```

Runtime commands:

```bash
# Terminal A — one persistent browser/CDP session
npm run browser:agent

# Terminal B
npm run browser:check
npm run browser:smoke
npm run browser:smoke
```

Current verified baseline:

```text
34/34 tests PASS
typecheck PASS
build PASS
persistent agent health PASS
smoke #1 PASS
smoke #2 PASS
```

---

# Maintenance Rule

Khi phát hiện bug mới, thêm section mới theo template sau thay vì sửa/xóa lịch sử cũ:

```markdown
## BUG-XXX — Tên bug

### Triệu chứng
...

### Nguyên nhân gốc
...

### Code trước khi sửa
```ts
...
```

### Code sau khi sửa
```ts
...
```

### Files affected
...

### Verification
...
```

Nguyên tắc:

1. Không xóa bug cũ sau khi đã fix.
2. Luôn giữ code before/after hoặc patch representative.
3. Ghi rõ nguyên nhân gốc, không chỉ ghi symptom.
4. Ghi command/test đã dùng để verify.
5. Nếu một fix gây regression mới, tạo BUG ID mới và reference bug trước đó.

