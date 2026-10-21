import type { CallToolResult, Client, Tool } from '@modelcontextprotocol/client';
import { mountCard, uiResourceUri, type MountedCard } from './apphost';
import { speakable, unbackedClaim } from './guard';
import { escapeHtml } from './inspector';
import { chat, toFunctions } from './llm';
import { connectDevice } from './mcp';
import type { ChatMessage, CountertopConfig, DeviceConfig } from './types';
import { canListen, chime, listen, speak } from './voice';

type ElicitContent = Record<string, string | number | boolean | string[]>;

const MAX_TOOL_ROUNDS = 6;
const YES = /\b(yes|yeah|yep|sure|ok(ay)?|please do|go ahead|do it|place it|confirm|correct|that'?s right)\b/i;
const NO = /\b(no|nope|don'?t|do not|cancel|stop|never ?mind|not now|wait)\b/i;

interface PendingElicitation {
  resolve: (answer: { action: 'accept' | 'decline' | 'cancel'; content?: ElicitContent }) => void;
  booleanField?: string;
}

type TurnSource = 'user' | 'notification' | 'card';

export class Device {
  readonly el: HTMLElement;
  private client!: Client;
  private tools: Tool[] = [];
  private functions: ReturnType<typeof toFunctions> = [];
  private history: ChatMessage[] = [];
  private instructions = '';
  private busy = false;
  private queue: Array<[string, TurnSource]> = [];
  private elicitation: PendingElicitation | null = null;
  private card: MountedCard | null = null;
  private seen = new Set<string>();
  private listening: { stop: () => void } | null = null;

  private $ = <T extends HTMLElement = HTMLElement>(sel: string) => this.el.querySelector<T>(sel)!;

  constructor(
    readonly cfg: DeviceConfig,
    private readonly app: CountertopConfig,
  ) {
    this.el = document.createElement('section');
    this.el.className = `device ${cfg.variant}`;
    this.el.innerHTML = `
      <div class="device-head">
        <span class="device-name">${escapeHtml(cfg.label)}</span>
        <span class="status" title="MCP connection">connecting…</span>
      </div>
      <div class="frame">
        <div class="screen">
          ${cfg.variant === 'phone' ? `<div class="phone-top"><span class="clock-small"></span><span>Assistant</span></div>` : ''}
          <div class="stage">
            <div class="idle">
              <div class="idle-time"></div>
              <div class="idle-date"></div>
              <div class="idle-title">${escapeHtml(cfg.idleTitle ?? '')}</div>
            </div>
          </div>
          <div class="feed"></div>
          <div class="caption"><div class="said"></div><div class="reply"></div></div>
          <div class="toasts"></div>
          <div class="elicit hidden"></div>
          <div class="listen-bar"></div>
        </div>
      </div>
      <div class="controls">
        <button class="mic" title="${canListen ? 'Push to talk' : 'Speech recognition unavailable in this browser'}" ${canListen ? '' : 'disabled'}>
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z"/></svg>
        </button>
        <form class="say"><input type="text" placeholder="Say something to ${escapeHtml(cfg.owner)}'s assistant…" /><button type="submit" class="secondary">Send</button></form>
      </div>
      <div class="chips">${(cfg.suggestions ?? []).map((s) => `<button class="chip" type="button">${escapeHtml(s)}</button>`).join('')}</div>`;

    this.$<HTMLFormElement>('form.say').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = this.$<HTMLInputElement>('form.say input');
      const text = input.value.trim();
      input.value = '';
      if (text) this.input(text);
    });
    this.el.querySelectorAll<HTMLButtonElement>('.chip').forEach((chip) => chip.addEventListener('click', () => this.input(chip.textContent ?? '')));
    this.$('.mic').addEventListener('click', () => this.toggleListening());
    this.tickClock(new Date());
  }

  // ------------------------------------------------------------------ lifecycle

  async connect() {
    try {
      this.client = await connectDevice(this.cfg);
      this.client.setRequestHandler('elicitation/create', async (req) => this.elicit(req.params as any));
      this.client.setNotificationHandler('notifications/resources/updated', (n) => void this.onResourceUpdated(n.params.uri));
      this.tools = (await this.client.listTools()).tools;
      this.functions = toFunctions(this.tools);
      this.instructions = this.client.getInstructions() ?? '';
      const version = this.client.getNegotiatedProtocolVersion();
      const server = this.client.getServerVersion();
      this.setStatus(`MCP ${version} · ${server?.name ?? 'server'} · ${this.tools.length} tools`, 'ok');

      if (this.client.getServerCapabilities()?.resources?.subscribe) {
        const { resources } = await this.client.listResources();
        for (const r of resources.filter((r) => /subscribe/i.test(r.description ?? ''))) {
          await this.primeSeen(r.uri);
          await this.client.subscribeResource({ uri: r.uri });
        }
      }
    } catch (err) {
      this.setStatus(`not connected: ${(err as Error).message}`, 'bad');
    }
  }

  private setStatus(text: string, kind: 'ok' | 'bad') {
    const s = this.$('.status');
    s.textContent = text;
    s.className = `status ${kind}`;
  }

  tickClock(now: Date) {
    const time = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const date = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
    // The idle screen disappears while a card is showing, so these may not exist.
    this.el.querySelectorAll('.idle-time, .clock-small').forEach((el) => (el.textContent = time));
    this.el.querySelectorAll('.idle-date').forEach((el) => (el.textContent = date));
  }

  // ------------------------------------------------------------------ input

  private input(text: string) {
    if (this.elicitation) return this.answerElicitation(text);
    void this.turn(text, 'user');
  }

  private toggleListening() {
    if (this.listening) {
      this.listening.stop();
      return;
    }
    const mic = this.$('.mic');
    mic.classList.add('on');
    this.el.classList.add('is-listening');
    this.showSaid('…');
    const session = listen((interim) => this.showSaid(interim || '…'));
    this.listening = session;
    session.done
      .then((text) => {
        if (text) this.input(text);
        else this.showSaid('');
      })
      .catch((err) => this.showReply(`Microphone: ${err.message}`))
      .finally(() => {
        this.listening = null;
        mic.classList.remove('on');
        this.el.classList.remove('is-listening');
      });
  }

  // ------------------------------------------------------------------ agent loop

  private systemPrompt(now: Date): string {
    const skills = this.app.skills.map((s) => s.content).filter(Boolean).join('\n\n---\n\n');
    return [
      `You are the voice assistant on "${this.cfg.label}", talking with ${this.cfg.owner}.`,
      `Current local time: ${now.toLocaleString([], { weekday: 'long', hour: 'numeric', minute: '2-digit', month: 'long', day: 'numeric' })}.`,
      'You are heard, not read: answer in one or two short, warm sentences. No markdown, no lists, no emoji. Say times like "8 AM".',
      'When a tool shows a card on the screen, give the one-line gist and mention it is on the screen instead of reading every detail.',
      'Prefer calling tools over guessing. You may call several tools in a row to finish the task.',
      'Never say you did something (logged, recorded, told someone, ordered) unless a tool result in this conversation confirms it.',
      skills ? `\nAgent skill instructions:\n${skills}` : '',
      this.instructions ? `\nInstructions from the connected MCP server:\n${this.instructions}` : '',
    ].join('\n');
  }

  private async now(): Promise<Date> {
    if (!this.app.demo?.url) return new Date();
    try {
      const s = await fetch(`${this.app.demo.url}/state`).then((r) => r.json());
      return new Date(s.now);
    } catch {
      return new Date();
    }
  }

  async turn(text: string, source: TurnSource) {
    if (this.busy) {
      this.queue.push([text, source]);
      return;
    }
    if (!this.client) return this.showReply('Not connected to the MCP server.');
    this.busy = true;
    this.el.classList.add('is-thinking');
    try {
      const now = await this.now();
      if (this.history.length === 0) this.history.push({ role: 'system', content: this.systemPrompt(now) });
      else this.history[0] = { role: 'system', content: this.systemPrompt(now) };

      if (source === 'user') {
        this.showSaid(text);
        this.addBubble('user', text);
        this.history.push({ role: 'user', content: text });
      } else if (source === 'card') {
        this.showSaid(`(tapped) ${text}`);
        this.addBubble('user', text);
        this.history.push({ role: 'user', content: text });
      } else {
        // A notification: nobody spoke, so don't leave the last utterance captioned above it.
        this.showSaid('');
        this.history.push({ role: 'user', content: text });
      }
      this.showReply('');

      let toolCallsThisTurn = 0;
      let challenged = false;
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const msg = await chat(recentHistory(this.history), this.functions);
        this.history.push(msg);
        const calls = msg.tool_calls ?? [];
        toolCallsThisTurn += calls.length;
        if (calls.length === 0) {
          const reply = speakable(msg.content ?? '');
          // Guardrail: the assistant may not claim an action it never took. Send it back once to do it for real.
          if (!challenged && unbackedClaim(reply, toolCallsThisTurn)) {
            challenged = true;
            this.history.push({
              role: 'user',
              content: `[Countertop check — not from ${this.cfg.owner}] Your reply claims you did something, but you called no tool this turn, so nothing happened. Call the right tool now; then reply based only on its result.`,
            });
            continue;
          }
          this.showReply(reply);
          this.addBubble('assistant', reply);
          await speak(reply);
          break;
        }
        for (const call of calls) {
          const tool = this.tools.find((t) => t.name === call.function.name);
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(call.function.arguments || '{}');
          } catch {
            /* leave empty */
          }
          this.addToolChip(tool?.title ?? call.function.name);
          let result: CallToolResult;
          try {
            // Generous timeout: a tool may be waiting on the person to answer a confirmation.
            result = (await this.client.callTool({ name: call.function.name, arguments: args }, { timeout: 5 * 60_000 })) as CallToolResult;
          } catch (err) {
            result = { content: [{ type: 'text', text: `Tool error: ${(err as Error).message}` }], isError: true };
          }
          const hasUi = Boolean(uiResourceUri(tool)) && !result.isError;
          this.history.push({ role: 'tool', tool_call_id: call.id, name: call.function.name, content: formatToolResult(result, hasUi) });
          if (hasUi && tool) await this.showCard(tool, args, result);
        }
      }
    } catch (err) {
      const message = `Sorry, something went wrong: ${(err as Error).message}`;
      this.showReply(message);
      this.addBubble('assistant', message);
    } finally {
      this.busy = false;
      this.el.classList.remove('is-thinking');
      const next = this.queue.shift();
      if (next) void this.turn(...next);
    }
  }

  // ------------------------------------------------------------------ cards (MCP Apps)

  private async showCard(tool: Tool, args: Record<string, unknown>, result: CallToolResult) {
    let container: HTMLElement;
    if (this.cfg.variant === 'display') {
      container = this.$('.stage');
    } else {
      const bubble = document.createElement('div');
      bubble.className = 'bubble card';
      this.$('.feed').appendChild(bubble);
      container = bubble;
    }
    await this.card?.dispose();
    this.card = await mountCard({
      client: this.client,
      tool,
      args,
      result,
      container,
      theme: 'light',
      onMessage: (text) => void this.turn(text, 'card'),
    }).catch((err) => {
      console.warn('card failed', err);
      return null;
    });
    this.scrollFeed();
  }

  // ------------------------------------------------------------------ elicitation

  private elicit(params: { message: string; requestedSchema?: any; mode?: string }): Promise<{ action: 'accept' | 'decline' | 'cancel'; content?: ElicitContent }> {
    const box = this.$('.elicit');
    const props = Object.entries<any>(params.requestedSchema?.properties ?? {});
    const booleanOnly = props.length === 1 && props[0][1].type === 'boolean';
    chime();
    this.showReply(params.message);
    void speak(params.message);

    return new Promise((resolve) => {
      const finish = (answer: { action: 'accept' | 'decline' | 'cancel'; content?: ElicitContent }) => {
        this.elicitation = null;
        box.classList.add('hidden');
        box.innerHTML = '';
        resolve(answer);
      };
      this.elicitation = { resolve: finish, booleanField: booleanOnly ? props[0][0] : undefined };

      if (booleanOnly) {
        const field = props[0];
        box.innerHTML = `
          <div class="elicit-card">
            <div class="elicit-kicker">Confirm</div>
            <div class="elicit-msg">${escapeHtml(params.message)}</div>
            ${field[1].description ? `<div class="elicit-detail">${escapeHtml(field[1].description)}</div>` : ''}
            <div class="elicit-actions"><button class="yes">Yes</button><button class="no secondary">No</button></div>
            <div class="elicit-hint">Say “yes” or “no”</div>
          </div>`;
        box.querySelector('.yes')!.addEventListener('click', () => finish({ action: 'accept', content: { [field[0]]: true } }));
        box.querySelector('.no')!.addEventListener('click', () => finish({ action: 'decline' }));
      } else {
        // Generic form rendering for any flat elicitation schema.
        box.innerHTML = `
          <form class="elicit-card">
            <div class="elicit-kicker">${escapeHtml(this.cfg.owner)}, a quick question</div>
            <div class="elicit-msg">${escapeHtml(params.message)}</div>
            ${props
              .map(([name, p]) => {
                const label = escapeHtml(p.title ?? name);
                if (p.enum) return `<label>${label}<select name="${name}">${p.enum.map((v: string) => `<option>${escapeHtml(v)}</option>`).join('')}</select></label>`;
                if (p.type === 'boolean') return `<label class="check"><input type="checkbox" name="${name}"/> ${label}</label>`;
                return `<label>${label}<input name="${name}" type="${p.type === 'number' || p.type === 'integer' ? 'number' : 'text'}"/></label>`;
              })
              .join('')}
            <div class="elicit-actions"><button type="submit">Submit</button><button type="button" class="no secondary">Cancel</button></div>
          </form>`;
        const form = box.querySelector('form')!;
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const content: ElicitContent = {};
          for (const [name, p] of props) {
            const input = form.elements.namedItem(name) as HTMLInputElement;
            content[name] = p.type === 'boolean' ? input.checked : p.type === 'number' || p.type === 'integer' ? Number(input.value) : input.value;
          }
          finish({ action: 'accept', content });
        });
        box.querySelector('.no')!.addEventListener('click', () => finish({ action: 'cancel' }));
      }
      box.classList.remove('hidden');
    });
  }

  /**
   * A spoken answer only confirms when it is short and clearly yes/no. Anything else
   * ("I fell this morning but I'm okay") cancels the confirmation and is handled as a new request —
   * a purchase must never be approved by a sentence that merely contains "okay".
   */
  private answerElicitation(text: string) {
    const pending = this.elicitation!;
    const words = text.trim().split(/\s+/).length;
    const clear = words <= 5;
    if (pending.booleanField && clear && NO.test(text)) {
      this.showSaid(text);
      this.addBubble('user', text);
      return pending.resolve({ action: 'decline' });
    }
    if (pending.booleanField && clear && YES.test(text)) {
      this.showSaid(text);
      this.addBubble('user', text);
      return pending.resolve({ action: 'accept', content: { [pending.booleanField]: true } });
    }
    if (!pending.booleanField && clear && NO.test(text)) {
      this.showSaid(text);
      this.addBubble('user', text);
      return pending.resolve({ action: 'cancel' });
    }
    pending.resolve({ action: 'cancel' });
    void this.turn(text, 'user');
  }

  // ------------------------------------------------------------------ proactive notifications

  private async readItems(uri: string): Promise<Array<{ id: string; title: string; detail: string; severity?: string; kind?: string }>> {
    const res = await this.client.readResource({ uri });
    const text = (res.contents[0] as { text?: string })?.text ?? '[]';
    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed.filter((i) => i && i.id) : [];
    } catch {
      return [];
    }
  }

  private async primeSeen(uri: string) {
    for (const item of await this.readItems(uri)) this.seen.add(item.id);
  }

  private async onResourceUpdated(uri: string) {
    const fresh = (await this.readItems(uri)).filter((i) => !this.seen.has(i.id));
    if (fresh.length === 0) return;
    fresh.forEach((i) => this.seen.add(i.id));
    const urgent = fresh.some((i) => i.severity === 'urgent');
    chime(urgent);
    for (const item of fresh) this.toast(item.title, item.detail, item.severity ?? 'info');
    const lines = fresh.map((i) => `- (${i.kind ?? 'notice'}, ${i.severity ?? 'info'}) ${i.title}: ${i.detail}`).join('\n');
    void this.turn(
      `[Device notification — this was not said by ${this.cfg.owner}. It just arrived on the device.]\n${lines}\n` +
        `Your reply is spoken aloud to ${this.cfg.owner} right now: talk to them directly in one or two short sentences and offer the most helpful next step. Output only the words to say — no preamble like "I would say". ` +
        `Don't call check_inbox for these.`,
      'notification',
    );
  }

  private toast(title: string, detail: string, severity: string) {
    const t = document.createElement('div');
    t.className = `toast ${severity}`;
    t.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span>`;
    this.$('.toasts').appendChild(t);
    setTimeout(() => t.classList.add('gone'), 9000);
    setTimeout(() => t.remove(), 9600);
  }

  // ------------------------------------------------------------------ rendering helpers

  private showSaid(text: string) {
    this.$('.said').textContent = text;
  }

  private captionTimer: ReturnType<typeof setTimeout> | undefined;

  private showReply(text: string) {
    this.$('.reply').textContent = text;
    // On the display the caption overlays the card; let it fade once it has been heard.
    const caption = this.$('.caption');
    caption.classList.remove('faded');
    clearTimeout(this.captionTimer);
    if (text) this.captionTimer = setTimeout(() => !this.busy && caption.classList.add('faded'), 14_000);
  }

  private addBubble(who: 'user' | 'assistant', text: string) {
    if (!text) return;
    const b = document.createElement('div');
    b.className = `bubble ${who}`;
    b.textContent = text;
    this.$('.feed').appendChild(b);
    this.scrollFeed();
  }

  private addToolChip(name: string) {
    const c = document.createElement('div');
    c.className = 'tool-chip';
    c.textContent = name;
    this.$('.feed').appendChild(c);
    const live = document.createElement('span');
    live.className = 'tool-live';
    live.textContent = name;
    const caption = this.$('.reply');
    caption.replaceChildren(live);
    this.scrollFeed();
  }

  private scrollFeed() {
    const f = this.$('.feed');
    f.scrollTop = f.scrollHeight;
  }

  clearConversation() {
    this.history = [];
    this.$('.feed').innerHTML = '';
    this.showSaid('');
    this.showReply('');
    void this.card?.dispose();
    this.card = null;
    if (this.cfg.variant === 'display') {
      this.$('.stage').innerHTML = `<div class="idle"><div class="idle-time"></div><div class="idle-date"></div><div class="idle-title">${escapeHtml(this.cfg.idleTitle ?? '')}</div></div>`;
      this.tickClock(new Date());
    }
  }
}

/** System prompt plus the last few exchanges, cut at a user message so tool calls stay paired with their results. */
const KEEP_USER_TURNS = 4;
function recentHistory(history: ChatMessage[]): ChatMessage[] {
  const userIdx = history.map((m, i) => (m.role === 'user' ? i : -1)).filter((i) => i > 0);
  if (userIdx.length <= KEEP_USER_TURNS) return history;
  return [history[0], ...history.slice(userIdx[userIdx.length - KEEP_USER_TURNS])];
}

function formatToolResult(result: CallToolResult, hasUi: boolean): string {
  const text = (result.content ?? [])
    .filter((c: any) => c.type === 'text')
    .map((c: any) => c.text)
    .join('\n');
  // A readable text summary is what the model needs; raw structured JSON only when there is no summary.
  // (Keeps prompts small enough for free-tier token-per-minute limits.)
  const structured = result.structuredContent && text.length < 40 ? `\nstructuredContent: ${JSON.stringify(result.structuredContent).slice(0, 2000)}` : '';
  const note = hasUi ? '\n[A card with these details is now showing on the device screen.]' : '';
  const out = `${result.isError ? 'ERROR: ' : ''}${text}${structured}${note}`;
  return out.length > 3000 ? `${out.slice(0, 3000)}…` : out;
}
