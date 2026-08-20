import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ReviewerTransport } from '../reviewer/transport.js';
import type { ChatGptReviewRequest } from './types.js';

export interface ChatGptBrowserOptions {
  cdpUrl?: string;
  devToolsActivePortFile?: string;
  chatUrl?: string;
  timeoutMs?: number;
  settleMs?: number;
  newChatPerReview?: boolean;
  persistentConnection?: boolean;
  accountHint?: string;
}

export interface BrowserReviewResult {
  response: string;
  conversationId?: string;
}

type CdpResult = Record<string, any>;

class RawCdpClient {
  private ws!: WebSocket;
  private seq = 0;
  private readonly pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();

  async connect(wsUrl: string, timeoutMs: number): Promise<void> {
    this.ws = new WebSocket(wsUrl);
    this.ws.onmessage = event => {
      const msg = JSON.parse(String(event.data));
      if (!msg.id) return;
      const pending = this.pending.get(msg.id);
      if (!pending) return;
      this.pending.delete(msg.id);
      if (msg.error) pending.reject(new Error(JSON.stringify(msg.error)));
      else pending.resolve(msg.result);
    };

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`CDP websocket connect timed out after ${timeoutMs}ms`)), timeoutMs);
      this.ws.onopen = () => { clearTimeout(timer); resolve(); };
      this.ws.onerror = () => { clearTimeout(timer); reject(new Error(`Failed to connect to CDP websocket: ${wsUrl}`)); };
    });
  }

  send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<CdpResult> {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      this.pending.set(id, { resolve, reject });
      const message: Record<string, unknown> = { id, method, params };
      if (sessionId) message.sessionId = sessionId;
      this.ws.send(JSON.stringify(message));
    });
  }

  isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  close(): void {
    this.ws?.close();
  }
}

function defaultDevToolsActivePortFile(): string {
  return path.join(os.homedir(), 'Library/Application Support/Google/Chrome/DevToolsActivePort');
}

export function resolveBrowserWebSocketUrl(options: ChatGptBrowserOptions = {}): string {
  if (options.cdpUrl?.startsWith('ws://') || options.cdpUrl?.startsWith('wss://')) return options.cdpUrl;

  const activePortFile = options.devToolsActivePortFile ?? defaultDevToolsActivePortFile();
  const raw = fs.readFileSync(activePortFile, 'utf8').trim().split(/\r?\n/);
  const port = raw[0];
  const browserPath = raw[1];
  if (!port || !browserPath) throw new Error(`Invalid DevToolsActivePort file: ${activePortFile}`);
  return `ws://127.0.0.1:${port}${browserPath}`;
}

export function buildBrowserReviewPrompt(request: ChatGptReviewRequest): string;
export function buildBrowserReviewPrompt(systemPrompt: string, handoff: string): string;
export function buildBrowserReviewPrompt(
  requestOrSystemPrompt: ChatGptReviewRequest | string,
  handoff?: string,
): string {
  const systemPrompt = typeof requestOrSystemPrompt === 'string'
    ? requestOrSystemPrompt
    : requestOrSystemPrompt.systemPrompt;
  const handoffMarkdown = typeof requestOrSystemPrompt === 'string'
    ? (handoff ?? '')
    : requestOrSystemPrompt.handoffMarkdown;
  const projectContext = typeof requestOrSystemPrompt === 'string'
    ? undefined
    : requestOrSystemPrompt.projectContext;
  const contextMarkdown = projectContext
    ? [
        '--- PROJECT CONTEXT ---',
        `Project ID: ${projectContext.projectId}`,
        '',
        '## Project Overview',
        projectContext.overview || '(not provided)',
        '',
        '## Project Progress',
        projectContext.progress || '(not provided)',
        '',
      ].join('\n')
    : '';

  return `${systemPrompt}\n\n${contextMarkdown}--- PR HANDOFF ---\n${handoffMarkdown}\n\nReturn the Review Contract JSON only. The response MUST be syntactically valid JSON parseable by JSON.parse. Escape every double quote that appears inside a JSON string value. Do not use Markdown fences, comments, trailing commas, or any text before or after the JSON object.`;
}

export function buildConversationUrl(chatUrl: string, conversationId?: string): string {
  if (!conversationId) return chatUrl;
  if (!/^[a-zA-Z0-9-]+$/.test(conversationId)) {
    throw new Error(`Invalid ChatGPT conversation ID: ${conversationId}`);
  }
  return new URL(`/c/${conversationId}`, chatUrl).toString();
}

export function extractConversationId(url: string): string | undefined {
  try {
    return new URL(url).pathname.match(/^\/c\/([a-zA-Z0-9-]+)\/?$/)?.[1];
  } catch {
    return undefined;
  }
}

export function isNewAssistantResponse(
  beforeCount: number,
  beforeText: string,
  currentCount: number,
  currentText: string,
): boolean {
  return Boolean(currentText) && (currentCount > beforeCount || currentText !== beforeText);
}

export class ChromeCdpChatGptBrowserTransport implements ReviewerTransport {
  private readonly options: Required<Pick<ChatGptBrowserOptions, 'chatUrl' | 'timeoutMs' | 'settleMs' | 'newChatPerReview' | 'persistentConnection'>> & ChatGptBrowserOptions;
  private persistentClient?: RawCdpClient;

  constructor(options: ChatGptBrowserOptions = {}) {
    this.options = {
      ...options,
      chatUrl: options.chatUrl ?? 'https://chatgpt.com/',
      timeoutMs: options.timeoutMs ?? 120_000,
      settleMs: options.settleMs ?? 1_500,
      newChatPerReview: options.newChatPerReview ?? true,
      persistentConnection: options.persistentConnection ?? false,
    };
  }

  private async createClient(): Promise<RawCdpClient> {
    const client = new RawCdpClient();
    const wsUrl = resolveBrowserWebSocketUrl(this.options);
    await client.connect(wsUrl, Math.min(this.options.timeoutMs, 10_000));
    return client;
  }

  async connect(): Promise<void> {
    if (this.persistentClient?.isOpen()) return;
    this.persistentClient?.close();
    this.persistentClient = await this.createClient();
  }

  close(): void {
    this.persistentClient?.close();
    this.persistentClient = undefined;
  }

  private async acquireClient(): Promise<RawCdpClient> {
    if (this.options.persistentConnection) {
      await this.connect();
      if (!this.persistentClient) throw new Error('Persistent CDP client was not initialized.');
      return this.persistentClient;
    }
    return this.createClient();
  }

  private async selectAnchorTarget(
    client: RawCdpClient,
    targets: any[],
    conversationId?: string,
  ): Promise<any> {
    const orderedTargets = conversationId
      ? [
          ...targets.filter(target => extractConversationId(String(target.url ?? '')) === conversationId),
          ...targets.filter(target => extractConversationId(String(target.url ?? '')) !== conversationId),
        ]
      : targets;
    const accountHint = this.options.accountHint?.trim().toLowerCase();

    for (const target of orderedTargets) {
      const { sessionId } = await client.send('Target.attachToTarget', {
        targetId: target.targetId,
        flatten: true,
      });
      try {
        await client.send('Runtime.enable', {}, sessionId);
        const inspection = await client.send('Runtime.evaluate', {
          expression: `(() => {
            const text = document.body?.innerText || '';
            const attributes = [...document.querySelectorAll('button,[aria-label],[title]')]
              .flatMap(el => [el.innerText, el.getAttribute('aria-label'), el.getAttribute('title')])
              .filter(Boolean)
              .join(' ');
            const identity = attributes.toLowerCase();
            const composer = document.querySelector('#prompt-textarea') ||
              document.querySelector('#mobile-composer-prompt') ||
              document.querySelector('textarea[aria-label="Chat with ChatGPT"]') ||
              document.querySelector('textarea[placeholder="Ask anything"]') ||
              document.querySelector('[contenteditable="true"][data-lexical-editor="true"]');
            const ready = !!composer && !!(composer.offsetWidth || composer.offsetHeight || composer.getClientRects().length);
            const loggedOut = /Log in to get answers based on saved chats/i.test(text) ||
              [...document.querySelectorAll('button,a')].some(el =>
                (el.innerText || '').trim() === 'Log in' &&
                !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length));
            const accountHint = ${JSON.stringify(accountHint ?? '')};
            const accountMatches = !accountHint || identity.includes(accountHint);
            return { ready, authenticated: accountHint ? accountMatches : !loggedOut, identity };
          })()`,
          returnByValue: true,
        }, sessionId);
        const value = inspection.result?.value ?? {};
        if (value.ready && value.authenticated && (!accountHint || String(value.identity).includes(accountHint))) {
          return target;
        }
      } finally {
        await client.send('Target.detachFromTarget', { sessionId }).catch(() => {});
      }
    }

    const identity = accountHint ? ` matching account hint "${this.options.accountHint}"` : '';
    throw new Error(`No authenticated ChatGPT tab${identity} was found in the active Chrome session.`);
  }

  async review(request: ChatGptReviewRequest): Promise<string> {
    return (await this.reviewWithMetadata(request)).response;
  }

  async reviewWithMetadata(request: ChatGptReviewRequest): Promise<BrowserReviewResult> {
    const systemPrompt = request.systemPrompt;
    const handoff = request.handoffMarkdown;
    const client = await this.acquireClient();

    let reviewSessionId: string | undefined;
    try {
      const { targetInfos } = await client.send('Target.getTargets');
      const targets = (targetInfos ?? []).filter((t: any) => t.type === 'page' && String(t.url ?? '').includes('chatgpt.com'));
      if (!targets.length) throw new Error('No existing ChatGPT tab found in the active Chrome session. Open ChatGPT in Profile 2 first.');

      // Open every review from an already authenticated ChatGPT target. Chrome does
      // not allow Target.createTarget(browserContextId) for normal user profiles,
      // so opening from the Profile 2 page itself is what reliably inherits its
      // cookies, account and browser context without launching another browser.
      const requestedConversationId = request.projectContext?.conversationId;
      const anchorTarget = await this.selectAnchorTarget(client, targets, requestedConversationId);
      const existingConversationTarget = requestedConversationId &&
        extractConversationId(String(anchorTarget.url ?? '')) === requestedConversationId;
      let target = anchorTarget;
      if (!existingConversationTarget && (this.options.newChatPerReview || requestedConversationId)) {
        const existingTargetIds = new Set((targetInfos ?? []).map((t: any) => t.targetId));
        const { sessionId: anchorSessionId } = await client.send('Target.attachToTarget', {
          targetId: anchorTarget.targetId,
          flatten: true,
        });
        await client.send('Runtime.enable', {}, anchorSessionId);

        const reviewUrl = buildConversationUrl(
          this.options.chatUrl,
          request.projectContext?.conversationId,
        );
        const openResult = await client.send('Runtime.evaluate', {
          expression: `window.open(${JSON.stringify(reviewUrl)}, '_blank') !== null`,
          returnByValue: true,
          userGesture: true,
        }, anchorSessionId);
        await client.send('Target.detachFromTarget', { sessionId: anchorSessionId }).catch(() => {});

        if (!openResult.result?.value) {
          throw new Error('Chrome blocked creation of a new ChatGPT tab from the authenticated Profile 2 tab.');
        }

        const targetDeadline = Date.now() + 10_000;
        let createdTarget: any = null;
        while (Date.now() < targetDeadline) {
          const current = await client.send('Target.getTargets');
          createdTarget = (current.targetInfos ?? []).find((candidate: any) =>
            candidate.type === 'page' &&
            !existingTargetIds.has(candidate.targetId) &&
            String(candidate.url ?? '').includes('chatgpt.com') &&
            (!anchorTarget.browserContextId || candidate.browserContextId === anchorTarget.browserContextId)
          );
          if (createdTarget) break;
          await new Promise(resolve => setTimeout(resolve, 200));
        }

        if (!createdTarget) {
          throw new Error('A new ChatGPT tab was opened, but its Profile 2 CDP target was not discovered in time.');
        }
        target = createdTarget;
      }

      const { sessionId } = await client.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
      reviewSessionId = sessionId;
      await client.send('Runtime.enable', {}, sessionId);
      await client.send('Page.enable', {}, sessionId);

      const pageReadyDeadline = Date.now() + Math.min(this.options.timeoutMs, 30_000);
      let state: any = null;
      while (Date.now() < pageReadyDeadline) {
        const readiness = await client.send('Runtime.evaluate', {
          expression: `(() => {
            const text = document.body?.innerText || '';
            const composer = document.querySelector('#prompt-textarea') ||
              document.querySelector('#mobile-composer-prompt') ||
              document.querySelector('textarea[aria-label="Chat with ChatGPT"]') ||
              document.querySelector('textarea[placeholder="Ask anything"]') ||
              document.querySelector('[contenteditable="true"][data-lexical-editor="true"]');
            const visible = !!composer && !!(composer.offsetWidth || composer.offsetHeight || composer.getClientRects().length);
            const loggedOut = /Log in to get answers based on saved chats/i.test(text) ||
              [...document.querySelectorAll('button,a')].some(el =>
                (el.innerText || '').trim() === 'Log in' &&
                !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length));
            const identity = [...document.querySelectorAll('button,[aria-label],[title]')]
              .flatMap(el => [el.innerText, el.getAttribute('aria-label'), el.getAttribute('title')])
              .filter(Boolean)
              .join(' ').toLowerCase();
            const accountHint = ${JSON.stringify(this.options.accountHint?.trim().toLowerCase() ?? '')};
            const accountMatches = !accountHint || identity.includes(accountHint);
            return {
              readyState: document.readyState,
              ready: visible,
              authenticated: accountHint ? accountMatches : !loggedOut,
              accountMatches,
              href: location.href,
              title: document.title,
            };
          })()`,
          returnByValue: true,
        }, sessionId).catch(() => ({ result: { value: null } }));

        state = readiness.result?.value ?? null;
        if (state?.ready && state?.authenticated && state?.accountMatches) break;
        await new Promise(resolve => setTimeout(resolve, 300));
      }

      if (!state?.ready) {
        throw new Error(`ChatGPT composer did not become ready in the new Profile 2 chat. Last state: ${JSON.stringify(state)}`);
      }
      if (!state?.authenticated) {
        throw new Error('The selected ChatGPT tab is not authenticated.');
      }
      if (!state?.accountMatches) {
        throw new Error(`The selected ChatGPT tab does not match account hint "${this.options.accountHint}".`);
      }

      const prompt = buildBrowserReviewPrompt(request);
      const before = await client.send('Runtime.evaluate', {
        expression: `(() => {
          const els = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
          const users = [...document.querySelectorAll('[data-message-author-role="user"]')];
          return {
            count: els.length,
            text: (els.at(-1)?.innerText || '').trim(),
            userCount: users.length,
            userText: (users.at(-1)?.innerText || '').trim(),
          };
        })()`,
        returnByValue: true,
      }, sessionId);
      const beforeCount = Number(before.result?.value?.count ?? 0);
      const beforeText = String(before.result?.value?.text ?? '');
      const beforeUserCount = Number(before.result?.value?.userCount ?? 0);
      const beforeUserText = String(before.result?.value?.userText ?? '');

      const encoded = JSON.stringify(prompt);
      const fill = await client.send('Runtime.evaluate', {
        expression: `(() => {
          const el = document.querySelector('#prompt-textarea') || document.querySelector('#mobile-composer-prompt') || document.querySelector('textarea[aria-label="Chat with ChatGPT"]') || document.querySelector('textarea[placeholder="Ask anything"]') || document.querySelector('[contenteditable="true"][data-lexical-editor="true"]');
          if (!el) return {ok:false, reason:'NO_COMPOSER'};
          el.focus();
          const value = ${encoded};

          if (el instanceof HTMLTextAreaElement) {
            const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
            setter?.call(el, value);
            el.dispatchEvent(new Event('input', {bubbles:true}));
            el.dispatchEvent(new Event('change', {bubbles:true}));
          } else {
            const sel = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(el);
            sel?.removeAllRanges();
            sel?.addRange(range);
            document.execCommand('insertText', false, value);
            el.dispatchEvent(new InputEvent('input', {bubbles:true,inputType:'insertText',data:value}));
          }
          return {ok:true};
        })()`,
        returnByValue: true,
      }, sessionId);
      if (!fill.result?.value?.ok) throw new Error(`Failed to fill ChatGPT review prompt: ${fill.result?.value?.reason ?? 'unknown'}`);

      await new Promise(resolve => setTimeout(resolve, 800));

      const submit = await client.send('Runtime.evaluate', {
        expression: `(() => {
          const el = document.querySelector('#prompt-textarea') || document.querySelector('#mobile-composer-prompt') || document.querySelector('textarea[aria-label="Chat with ChatGPT"]') || document.querySelector('textarea[placeholder="Ask anything"]') || document.querySelector('[contenteditable="true"][data-lexical-editor="true"]');
          if (!el) return {ok:false, reason:'NO_COMPOSER'};
          const sendButton = document.querySelector('button[data-testid="send-button"]') ||
            document.querySelector('button[aria-label="Send message"]') ||
            [...document.querySelectorAll('button')].find(b => /send message/i.test(b.getAttribute('aria-label') || ''));
          if (sendButton && !sendButton.disabled) {
            sendButton.click();
            return {ok:true, method:'button'};
          }
          return {ok:false, reason:'SEND_BUTTON_UNAVAILABLE'};
        })()`,
        returnByValue: true,
      }, sessionId);
      if (!submit.result?.value?.ok) {
        await client.send('Input.dispatchKeyEvent', {
          type: 'keyDown',
          key: 'Enter',
          code: 'Enter',
          windowsVirtualKeyCode: 13,
          nativeVirtualKeyCode: 13,
        }, sessionId);
        await client.send('Input.dispatchKeyEvent', {
          type: 'keyUp',
          key: 'Enter',
          code: 'Enter',
          windowsVirtualKeyCode: 13,
          nativeVirtualKeyCode: 13,
        }, sessionId);
      }

      const submitDeadline = Date.now() + 10_000;
      let submitted = false;
      while (Date.now() < submitDeadline) {
        const userState = await client.send('Runtime.evaluate', {
          expression: `(() => {
            const users = [...document.querySelectorAll('[data-message-author-role="user"]')];
            return { count: users.length, text: (users.at(-1)?.innerText || '').trim() };
          })()`,
          returnByValue: true,
        }, sessionId);
        const count = Number(userState.result?.value?.count ?? 0);
        const text = String(userState.result?.value?.text ?? '');
        if (count > beforeUserCount || (text && text !== beforeUserText)) {
          submitted = true;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      if (!submitted) throw new Error('ChatGPT review prompt was filled but not submitted.');

      const deadline = Date.now() + this.options.timeoutMs;
      let lastText = '';
      let stableSince = 0;
      let conversationId = request.projectContext?.conversationId;

      while (Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 750));
        const response = await client.send('Runtime.evaluate', {
          expression: `(() => {
            const els = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
            return { count: els.length, text: (els.at(-1)?.innerText || '').trim(), href: location.href };
          })()`,
          returnByValue: true,
        }, sessionId);
        const value = response.result?.value ?? {};
        const text = String(value.text ?? '');
        const count = Number(value.count ?? 0);
        conversationId = extractConversationId(String(value.href ?? '')) ?? conversationId;
        if (!isNewAssistantResponse(beforeCount, beforeText, count, text)) continue;
        if (text !== lastText) {
          lastText = text;
          stableSince = Date.now();
          continue;
        }
        if (stableSince && Date.now() - stableSince >= this.options.settleMs) {
          return { response: text, conversationId };
        }
      }

      throw new Error(`Timed out waiting for ChatGPT review response after ${this.options.timeoutMs}ms`);
    } finally {
      if (reviewSessionId) {
        await client.send('Target.detachFromTarget', { sessionId: reviewSessionId }).catch(() => {});
      }
      if (!this.options.persistentConnection) client.close();
    }
  }
}

// Backward-compatible alias while callers migrate names.
export const PlaywrightChatGptBrowserTransport = ChromeCdpChatGptBrowserTransport;
