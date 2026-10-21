import type { CallToolResult, Client, Tool } from '@modelcontextprotocol/client';
import { mountCard, uiResourceUri, type MountedCard } from './apphost';
import { speakable, unbackedClaim } from './guard';
import { icon } from './icons';
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

export interface DeviceInfo {
  protocol: string;
  server: string;
  tools: number;
  resources: number;
  prompts: number;
}

export class Device {
  readonly el: HTMLElement;
  info: DeviceInfo | null = null;
  private client!: Client;
  private tools: Tool[] = [];
  private functions: ReturnType<typeof toFunctions> = [];
  private history: ChatMessage[] = [];
  private instructions = '';
  private busy = false;
  /** Turns run one at a time, in order; each caller gets a promise for its own turn. */
  private chain: Promise<void> = Promise.resolve();
  private elicitation: PendingElicitation | null = null;
  private card: MountedCard | null = null;
  private seen = new Set<string>();
  private listening: { stop: () => void } | null = null;
  private hintTimer: ReturnType<typeof setInterval> | undefined;

  private $ = <T extends HTMLElement = HTMLElement>(sel: string) => this.el.querySelector<T>(sel)!;

  constructor(
    readonly cfg: DeviceConfig,
    private readonly app: CountertopConfig,
  ) {
    this.el = document.createElement('article');
    this.el.className = `device ${cfg.variant}`;
    this.el.setAttribute('aria-label', cfg.label);
    const screen =
      cfg.variant === 'display'
        ? `<div class="screen">
             <div class="stage">${this.idleMarkup()}</div>
             <div class="caption" aria-live="polite"><p class="said"></p><p class="reply"></p></div>
             <div class="toasts" aria-live="assertive"></div>
             <div class="sheet" hidden></div>
             <div class="lightbar" aria-hidden="true"></div>
           </div>`
        : `<div class="screen">
             <header class="app-bar">
               <span class="app-time"></span>
               <span class="app-title">${icon('hearth', 18)} Hearth</span>
               <span class="app-dot" aria-hidden="true"></span>
             </header>
             <div class="feed" aria-live="polite"><p class="feed-empty">${escapeHtml(cfg.idleTitle ?? 'Ask a question')}</p></div>
             <div class="toasts" aria-live="assertive"></div>
             <div class="sheet" hidden></div>
             <div class="lightbar" aria-hidden="true"></div>
           </div>`;

    this.el.innerHTML = `
      <header class="device-head">
        <div>
          <h3 class="device-name">${escapeHtml(cfg.label)}</h3>
          ${cfg.role ? `<p class="device-role">${escapeHtml(cfg.role)}</p>` : ''}
        </div>
        <span class="conn" data-state="connecting">Connecting</span>
      </header>
      <div class="hardware">
        <div class="bezel">${screen}</div>
        ${cfg.variant === 'display' ? '<div class="base" aria-hidden="true"></div>' : ''}
      </div>
      <div class="controls">
        <button class="mic" type="button" aria-label="Talk to ${escapeHtml(cfg.owner)}'s assistant" title="${canListen ? 'Click and speak' : 'Speech recognition needs Edge or Chrome'}" ${canListen ? '' : 'disabled'}>
          ${icon('mic', 22)}
        </button>
        <form class="say">
          <label class="visually-hidden" for="say-${cfg.id}">Type what ${escapeHtml(cfg.owner)} says</label>
          <input id="say-${cfg.id}" type="text" autocomplete="off" placeholder="Type what ${escapeHtml(cfg.owner)} says" />
          <button type="submit" class="btn btn-quiet">Send</button>
        </form>
      </div>
      <div class="try">
        <p class="try-label">Try saying</p>
        <div class="chips">${(cfg.suggestions ?? []).map((s) => `<button class="chip" type="button">${escapeHtml(s)}</button>`).join('')}</div>
      </div>`;

    this.$<HTMLFormElement>('form.say').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = this.$<HTMLInputElement>('form.say input');
      const text = input.value.trim();
      input.value = '';
      if (text) void this.say(text);
    });
    this.el.querySelectorAll<HTMLButtonElement>('.chip').forEach((chip) => chip.addEventListener('click', () => void this.say(chip.textContent ?? '')));
    this.$('.mic').addEventListener('click', () => this.toggleListening());
    this.tickClock(new Date());
    this.rotateHints();
  }

  private idleMarkup(): string {
    return `<div class="idle">
      <p class="idle-time"></p>
      <p class="idle-date"></p>
      <p class="idle-title">${escapeHtml(this.cfg.idleTitle ?? '')}</p>
      <p class="idle-hint"></p>
    </div>`;
  }

  /** Like an Echo Show home screen, the idle display cycles through things to try. */
  private rotateHints() {
    const hints = this.cfg.suggestions ?? [];
    if (this.cfg.variant !== 'display' || hints.length === 0) return;
    let i = 0;
    const show = () => {
      const el = this.el.querySelector<HTMLElement>('.idle-hint');
      if (!el) return;
      el.classList.remove('in');
      void el.offsetWidth;
      el.textContent = `Try “${hints[i++ % hints.length]}”`;
      el.classList.add('in');
    };
    show();
    clearInterval(this.hintTimer);
    this.hintTimer = setInterval(show, 6000);
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
      const caps = this.client.getServerCapabilities();
      const resources = caps?.resources ? (await this.client.listResources()).resources : [];
      const prompts = caps?.prompts ? (await this.client.listPrompts()).prompts : [];
      this.info = {
        protocol: this.client.getNegotiatedProtocolVersion() ?? '?',
        server: this.client.getServerVersion()?.name ?? 'server',
        tools: this.tools.length,
        resources: resources.length,
        prompts: prompts.length,
      };
      this.setConn('ok', `Connected over MCP ${this.info.protocol}`);

      if (caps?.resources?.subscribe) {
        for (const r of resources.filter((r) => /subscribe/i.test(r.description ?? ''))) {
          await this.primeSeen(r.uri);
          await this.client.subscribeResource({ uri: r.uri });
        }
      }
      this.el.dispatchEvent(new CustomEvent('connected', { bubbles: true }));
    } catch (err) {
      this.setConn('bad', `Can't reach the MCP server at ${this.cfg.mcpUrl}`);
      console.warn(err);
    }
  }

  private setConn(state: 'ok' | 'bad', text: string) {
    const s = this.$('.conn');
    s.dataset.state = state;
    s.textContent = state === 'ok' ? 'Connected' : 'Offline';
    s.title = text;
  }

  tickClock(now: Date) {
    const time = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const date = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
    // The idle screen disappears while a card is showing, so these may not exist.
    this.el.querySelectorAll('.idle-time, .app-time').forEach((el) => (el.textContent = time));
    this.el.querySelectorAll('.idle-date').forEach((el) => (el.textContent = date));
  }

  // ------------------------------------------------------------------ input

  /** Say something to this device. Resolves when the assistant has finished responding. */
  say(text: string): Promise<void> {
    if (this.elicitation) {
      this.answerElicitation(text);
      return this.chain;
    }
    return this.turn(text, 'user');
  }

  private toggleListening() {
    if (this.listening) {
      this.listening.stop();
      return;
    }
    const mic = this.$('.mic');
    mic.classList.add('on');
    this.setState('listening', true);
    this.showSaid('Listening…');
    const session = listen((interim) => this.showSaid(interim || 'Listening…'));
    this.listening = session;
    session.done
      .then((text) => {
        if (text) void this.say(text);
        else this.showSaid('');
      })
      .catch((err) => this.showReply(`The microphone isn't available (${err.message}). Type instead.`))
      .finally(() => {
        this.listening = null;
        mic.classList.remove('on');
        this.setState('listening', false);
      });
  }

  private setState(state: 'listening' | 'thinking' | 'speaking' | 'alert', on: boolean) {
    this.el.classList.toggle(`is-${state}`, on);
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

  turn(text: string, source: TurnSource): Promise<void> {
    const run = this.chain.then(() => this.runTurn(text, source));
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async runTurn(text: string, source: TurnSource) {
    if (!this.client) {
      this.showReply('This device is not connected to the MCP server. Start it with npm run dev, then reload.');
      return;
    }
    this.busy = true;
    this.setState('thinking', true);
    try {
      const now = await this.now();
      if (this.history.length === 0) this.history.push({ role: 'system', content: this.systemPrompt(now) });
      else this.history[0] = { role: 'system', content: this.systemPrompt(now) };

      if (source === 'user' || source === 'card') {
        this.showSaid(source === 'card' ? `Tapped: ${text}` : text);
        this.addBubble('user', text);
      } else {
        // A notification: nobody spoke, so don't leave the last utterance captioned above it.
        this.showSaid('');
      }
      this.history.push({ role: 'user', content: text });
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
          // Announcements describe what the server already did ("the family has been alerted"), so they are exempt.
          if (!challenged && source !== 'notification' && unbackedClaim(reply, toolCallsThisTurn)) {
            challenged = true;
            this.history.push({
              role: 'user',
              content: `[Countertop check — not from ${this.cfg.owner}] Your reply claims you did something, but you called no tool this turn, so nothing happened. Call the right tool now; then reply based only on its result.`,
            });
            continue;
          }
          this.setState('thinking', false);
          this.showReply(reply);
          this.addBubble('assistant', reply);
          await speak(reply, () => this.setState('speaking', true));
          this.setState('speaking', false);
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
          this.showWorking(tool?.title ?? call.function.name);
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
      const raw = (err as Error).message;
      console.warn(`[${this.cfg.id}] turn failed:`, raw);
      // People hear this, so say something human; the details stay in the console.
      const message = /quota|rate limit|busy|429|503|exceeded|timeout/i.test(raw)
        ? "Sorry, I'm a little busy right now. Please ask me again in a moment."
        : 'Sorry, something went wrong on my side. Please try that again.';
      this.setState('thinking', false);
      this.showReply(message);
      this.addBubble('assistant', message);
      await speak(message, () => this.setState('speaking', true));
      this.setState('speaking', false);
    } finally {
      this.busy = false;
      this.setState('thinking', false);
      this.setState('speaking', false);
    }
  }

  // ------------------------------------------------------------------ cards (MCP Apps)

  private async showCard(tool: Tool, args: Record<string, unknown>, result: CallToolResult) {
    let container: HTMLElement;
    if (this.cfg.variant === 'display') {
      container = document.createElement('div');
      container.className = 'card-slot';
      const stage = this.$('.stage');
      stage.replaceChildren(container);
      stage.scrollTop = 0;
      clearInterval(this.hintTimer);
    } else {
      container = document.createElement('div');
      container.className = 'bubble card';
      this.$('.feed').appendChild(container);
    }
    await this.card?.dispose();
    this.card = await mountCard({
      client: this.client,
      tool,
      args,
      result,
      container,
      theme: this.cfg.variant === 'display' ? 'dark' : 'light',
      onMessage: (text) => void this.turn(text, 'card'),
    }).catch((err) => {
      console.warn('card failed', err);
      return null;
    });
    this.scrollFeed();
  }

  // ------------------------------------------------------------------ elicitation

  private elicit(params: { message: string; requestedSchema?: any; mode?: string }): Promise<{ action: 'accept' | 'decline' | 'cancel'; content?: ElicitContent }> {
    const sheet = this.$('.sheet');
    const props = Object.entries<any>(params.requestedSchema?.properties ?? {});
    const booleanOnly = props.length === 1 && props[0][1].type === 'boolean';
    chime();
    this.setState('thinking', false);
    this.showReply(params.message);
    void speak(params.message, () => this.setState('speaking', true)).then(() => this.setState('speaking', false));

    return new Promise((resolve) => {
      const finish = (answer: { action: 'accept' | 'decline' | 'cancel'; content?: ElicitContent }) => {
        this.elicitation = null;
        sheet.classList.remove('open');
        setTimeout(() => {
          sheet.hidden = true;
          sheet.innerHTML = '';
        }, 260);
        this.setState('thinking', true);
        resolve(answer);
      };
      this.elicitation = { resolve: finish, booleanField: booleanOnly ? props[0][0] : undefined };

      if (booleanOnly) {
        const field = props[0];
        sheet.innerHTML = `
          <div class="sheet-card" role="dialog" aria-label="Confirm">
            <p class="sheet-title">${escapeHtml(params.message)}</p>
            <div class="sheet-actions">
              <button class="btn btn-buy yes" type="button">Yes, go ahead</button>
              <button class="btn btn-quiet no" type="button">No</button>
            </div>
            <p class="sheet-hint">${icon('mic', 14)} Or say “yes” or “no”</p>
          </div>`;
        sheet.querySelector('.yes')!.addEventListener('click', () => finish({ action: 'accept', content: { [field[0]]: true } }));
        sheet.querySelector('.no')!.addEventListener('click', () => finish({ action: 'decline' }));
      } else {
        // Generic form rendering for any flat elicitation schema.
        sheet.innerHTML = `
          <form class="sheet-card" role="dialog" aria-label="${escapeHtml(params.message)}">
            <p class="sheet-title">${escapeHtml(params.message)}</p>
            ${props
              .map(([name, p]) => {
                const label = escapeHtml(p.title ?? name);
                if (p.enum) return `<label>${label}<select name="${name}">${p.enum.map((v: string) => `<option>${escapeHtml(v)}</option>`).join('')}</select></label>`;
                if (p.type === 'boolean') return `<label class="check"><input type="checkbox" name="${name}"/> ${label}</label>`;
                return `<label>${label}<input name="${name}" type="${p.type === 'number' || p.type === 'integer' ? 'number' : 'text'}"/></label>`;
              })
              .join('')}
            <div class="sheet-actions"><button class="btn btn-buy" type="submit">Send answer</button><button type="button" class="btn btn-quiet no">Cancel</button></div>
          </form>`;
        const form = sheet.querySelector('form')!;
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const content: ElicitContent = {};
          for (const [name, p] of props) {
            const input = form.elements.namedItem(name) as HTMLInputElement;
            content[name] = p.type === 'boolean' ? input.checked : p.type === 'number' || p.type === 'integer' ? Number(input.value) : input.value;
          }
          finish({ action: 'accept', content });
        });
        sheet.querySelector('.no')!.addEventListener('click', () => finish({ action: 'cancel' }));
      }
      sheet.hidden = false;
      requestAnimationFrame(() => sheet.classList.add('open'));
      (sheet.querySelector('.yes, input, select') as HTMLElement | null)?.focus({ preventScroll: true });
    });
  }

  /**
   * A spoken answer only confirms when it is short and clearly yes/no. Anything else
   * ("I fell this morning but I'm okay") cancels the confirmation and is handled as a new request —
   * a purchase must never be approved by a sentence that merely contains "okay".
   */
  private answerElicitation(text: string) {
    const pending = this.elicitation!;
    const clear = text.trim().split(/\s+/).length <= 5;
    const echo = () => {
      this.showSaid(text);
      this.addBubble('user', text);
    };
    if (pending.booleanField && clear && NO.test(text)) {
      echo();
      return pending.resolve({ action: 'decline' });
    }
    if (pending.booleanField && clear && YES.test(text)) {
      echo();
      return pending.resolve({ action: 'accept', content: { [pending.booleanField]: true } });
    }
    if (!pending.booleanField && clear && NO.test(text)) {
      echo();
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
    this.el.classList.remove('is-alert', 'is-urgent');
    void this.el.offsetWidth;
    this.el.classList.add('is-alert');
    if (urgent) this.el.classList.add('is-urgent');
    setTimeout(() => this.el.classList.remove('is-alert', 'is-urgent'), 6000);
    for (const item of fresh) this.toast(item.title, item.detail, item.severity ?? 'info');
    const lines = fresh.map((i) => `- (${i.kind ?? 'notice'}, ${i.severity ?? 'info'}) ${i.title}: ${i.detail}`).join('\n');
    void this.turn(
      `[Device notification — this was not said by ${this.cfg.owner}. It just arrived on the device.]\n${lines}\n` +
        `Your reply is spoken aloud to ${this.cfg.owner} right now: talk to them directly in one or two short sentences and offer the most helpful next step. Output only the words to say — no preamble like "I would say". ` +
        `You are the assistant, not ${this.cfg.owner} and not the sender: read a family message out to ${this.cfg.owner} (for example "Maya says she'll call you at 6"), never reply to it as if you were ${this.cfg.owner}. ` +
        `Don't call check_inbox for these.`,
      'notification',
    );
  }

  private toast(title: string, detail: string, severity: string) {
    const t = document.createElement('div');
    t.className = `toast ${severity}`;
    t.innerHTML = `<span class="toast-icon">${icon(severity === 'urgent' ? 'alert' : 'bell', 18)}</span><div><strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span></div>`;
    this.$('.toasts').appendChild(t);
    setTimeout(() => t.classList.add('gone'), 9000);
    setTimeout(() => t.remove(), 9600);
  }

  // ------------------------------------------------------------------ rendering helpers

  private showSaid(text: string) {
    const said = this.el.querySelector('.said');
    if (said) said.textContent = text;
  }

  private captionTimer: ReturnType<typeof setTimeout> | undefined;

  private showReply(text: string) {
    const reply = this.el.querySelector('.reply');
    if (!reply) return;
    reply.textContent = text;
    // On the display the caption overlays the card; let it fade once it has been heard.
    const caption = this.$('.caption');
    caption.classList.remove('faded');
    clearTimeout(this.captionTimer);
    if (text) this.captionTimer = setTimeout(() => !this.busy && caption.classList.add('faded'), 14_000);
  }

  private showWorking(name: string) {
    const reply = this.el.querySelector('.reply');
    if (reply) reply.innerHTML = `<span class="working">${escapeHtml(name)}</span>`;
    const chip = document.createElement('p');
    chip.className = 'tool-chip';
    chip.innerHTML = `${icon('bolt', 13)} ${escapeHtml(name)}`;
    this.el.querySelector('.feed')?.appendChild(chip);
    this.scrollFeed();
  }

  private addBubble(who: 'user' | 'assistant', text: string) {
    const feed = this.el.querySelector('.feed');
    if (!text || !feed) return;
    feed.querySelector('.feed-empty')?.remove();
    const b = document.createElement('p');
    b.className = `bubble ${who}`;
    b.textContent = text;
    feed.appendChild(b);
    this.scrollFeed();
  }

  private scrollFeed() {
    const f = this.el.querySelector<HTMLElement>('.feed');
    if (f) f.scrollTo({ top: f.scrollHeight, behavior: 'smooth' });
  }

  clearConversation() {
    this.history = [];
    void this.card?.dispose();
    this.card = null;
    this.showSaid('');
    this.showReply('');
    const feed = this.el.querySelector('.feed');
    if (feed) feed.innerHTML = `<p class="feed-empty">${escapeHtml(this.cfg.idleTitle ?? 'Ask a question')}</p>`;
    if (this.cfg.variant === 'display') {
      this.$('.stage').innerHTML = this.idleMarkup();
      this.tickClock(new Date());
      this.rotateHints();
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
