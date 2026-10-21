import './styles.css';
import { Device } from './device';
import { icon } from './icons';
import { escapeHtml, mountInspector } from './inspector';
import type { CountertopConfig, StoryStep } from './types';
import { configureVoice, isMuted, setMuted } from './voice';

/** The day band spans 6 AM to 10 PM. */
const DAY_START = 6 * 60;
const DAY_END = 22 * 60;
const dayFraction = (minutes: number) => Math.min(1, Math.max(0, (minutes - DAY_START) / (DAY_END - DAY_START)));
const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** Sky colours for the hour, so the band reads as morning, daytime, dusk or night at a glance. */
function skyFor(minutes: number): [string, string] {
  const h = minutes / 60;
  if (h < 6.5 || h >= 21) return ['#1a2a4a', '#0e1c33'];
  if (h < 9) return ['#f0a35e', '#3e3f74'];
  if (h < 17) return ['#4f9ad6', '#2b5e8f'];
  return ['#e8875a', '#4a3a6b'];
}

async function boot() {
  const config: CountertopConfig = await fetch('/api/config').then((r) => r.json());
  configureVoice(config.voice?.preferred);
  document.title = `${config.title} · Alexa+ simulator`;

  const app = document.getElementById('app')!;
  const presets = config.demo?.presets ?? [];
  const story = config.story ?? [];

  app.innerHTML = `
    <a class="skip" href="#stage">Skip to the devices</a>
    <header class="topbar">
      <div class="topbar-inner">
        <a class="brand" href="#top" aria-label="${escapeHtml(config.title)}">
          <span class="brand-mark">${icon('hearth', 26)}</span>
          <span class="brand-name">${escapeHtml(config.title)}</span>
          <span class="brand-for">for Alexa+</span>
        </a>
        <div class="topbar-status">
          <span class="status-pill" data-state="connecting"><i></i><span class="status-text">Connecting devices</span></span>
          <span class="model-pill" title="Language model behind the simulated assistant">${escapeHtml(config.llm.configured ? config.llm.model : 'No LLM key set')}</span>
        </div>
        <nav class="topbar-actions" aria-label="Simulator controls">
          <button class="btn btn-dark" id="mute" type="button" aria-pressed="false">${icon('volume', 18)}<span>Voice on</span></button>
          <button class="btn btn-dark" id="clear" type="button">New conversation</button>
          ${config.demo ? `<button class="btn btn-dark" id="reset" type="button">${icon('reset', 16)}<span>Reset demo</span></button>` : ''}
        </nav>
      </div>
    </header>

    <section class="day" id="top" aria-labelledby="headline">
      <div class="day-inner">
        <div class="day-copy">
          <p class="day-kicker">${escapeHtml(config.subtitle ?? '')}</p>
          <h1 id="headline">${escapeHtml(config.headline ?? config.title)}</h1>
          ${config.intro ? `<p class="day-intro">${escapeHtml(config.intro)}</p>` : ''}
        </div>
        ${
          config.demo
            ? `<div class="clock-panel" aria-label="June's day: move the demo clock">
                <div class="clock-readout">
                  <span class="clock-day">June's day</span>
                  <output class="clock-time" aria-live="polite">--:--</output>
                  <button class="btn btn-glass small" data-advance="15" type="button">+15 min</button>
                </div>
                <div class="sky" aria-hidden="true">
                  <svg class="arc" viewBox="0 0 100 40" preserveAspectRatio="none"><path d="M0 40 Q50 -8 100 40" /></svg>
                  ${presets.map((p) => `<i class="tick" style="--x:${dayFraction(minutesOf(p.time))}"></i>`).join('')}
                  <span class="orb"></span>
                </div>
                <ol class="stops">
                  ${presets
                    .map(
                      (p) => `<li>
                        <button class="stop" data-time="${p.time}" type="button">
                          <span class="stop-time">${escapeHtml(p.label)}</span>
                          ${p.caption ? `<span class="stop-caption">${escapeHtml(p.caption)}</span>` : ''}
                        </button>
                      </li>`,
                    )
                    .join('')}
                </ol>
              </div>`
            : ''
        }
      </div>
    </section>

    <main>
      <section class="showcase" id="stage" aria-label="Simulated devices">
        <div class="devices"></div>
        ${
          story.length
            ? `<aside class="story" aria-labelledby="story-title">
                <div class="story-head">
                  <h2 id="story-title">Run the story</h2>
                  <p>Each step plays on the right device. Run them in order for the full demo.</p>
                  <button class="btn btn-buy wide" id="next-step" type="button">${icon('play', 18)}<span>Play step 1</span></button>
                </div>
                <ol class="steps">
                  ${story
                    .map((s, i) => {
                      const target = s.device ? config.devices.find((d) => d.id === s.device) : null;
                      const where = s.time ? `Clock to ${escapeHtml(presets.find((p) => p.time === s.time)?.label ?? s.time)}` : escapeHtml(target?.owner ?? '');
                      return `<li class="step" data-i="${i}">
                        <span class="step-num" aria-hidden="true"><span>${i + 1}</span>${icon('check', 16)}</span>
                        <div class="step-body">
                          <p class="step-title">${escapeHtml(s.title)}</p>
                          ${s.say ? `<p class="step-say">“${escapeHtml(s.say)}”</p>` : ''}
                          ${s.note ? `<p class="step-note">${escapeHtml(s.note)}</p>` : ''}
                        </div>
                        <button class="step-run" type="button" aria-label="Play step ${i + 1}: ${escapeHtml(s.title)}">
                          <span class="step-where">${s.time ? icon('bell', 14) : target?.variant === 'phone' ? icon('phone', 14) : icon('display', 14)}${where}</span>
                          ${icon('play', 14)}
                        </button>
                      </li>`;
                    })
                    .join('')}
                </ol>
              </aside>`
            : ''
        }
      </section>

      <section class="console" aria-labelledby="console-title">
        <div class="section-head">
          <div>
            <h2 id="console-title">What the devices and the server are saying</h2>
            <p>Every message on the Model Context Protocol connection, live. Click a row to see the full JSON.</p>
          </div>
          <dl class="facts"></dl>
        </div>
        <div class="console-panel"></div>
      </section>

      <section class="how" aria-labelledby="how-title">
        <h2 id="how-title">How it works</h2>
        <div class="how-grid">
          <div class="how-item">
            <span class="how-icon">${icon('server', 22)}</span>
            <h3>Hearth MCP server</h3>
            <p>A self-hosted Alexa+ add-on on MCP 2025-11-25 over Streamable HTTP. It keeps June's medicines, doses, check-ins and orders, and pushes reminders and alerts to whoever needs them.</p>
          </div>
          <div class="how-item">
            <span class="how-icon">${icon('display', 22)}</span>
            <h3>Countertop simulator</h3>
            <p>The Alexa+ developer tools are invite-only, so this page plays the part: a real MCP client per device, voice in and out, on-screen cards, spoken confirmations and the live message log.</p>
          </div>
          <div class="how-item">
            <span class="how-icon">${icon('skill', 22)}</span>
            <h3>Care skill</h3>
            <p>An Agent Skill tells the assistant how to talk to an older adult and a busy caregiver: short sentences, what each pill looks like, never dosing advice, and confirm before buying.</p>
          </div>
        </div>
      </section>
    </main>

    <footer class="footer">
      <div class="footer-inner">
        <p>${icon('hearth', 18)} Hearth is a hackathon project. The family is fictional and the pharmacy is simulated, so nothing is ordered or charged.</p>
        <nav aria-label="Project links">${(config.links ?? []).map((l) => `<a href="${escapeHtml(l.href)}" target="_blank" rel="noopener">${icon('github', 16)} ${escapeHtml(l.label)}</a>`).join('')}</nav>
      </div>
    </footer>`;

  // ---------------------------------------------------------------- devices & console
  const devices = config.devices.map((d) => new Device(d, config));
  const devicesEl = app.querySelector('.devices')!;
  devices.forEach((d) => devicesEl.appendChild(d.el));
  mountInspector(app.querySelector('.console-panel')!, config.devices.map((d) => ({ id: d.id, label: d.owner })));

  const statusPill = app.querySelector<HTMLElement>('.status-pill')!;
  const facts = app.querySelector<HTMLElement>('.facts')!;
  const refreshStatus = () => {
    const up = devices.filter((d) => d.info);
    statusPill.dataset.state = up.length === devices.length ? 'ok' : up.length ? 'partial' : 'connecting';
    statusPill.querySelector('.status-text')!.textContent =
      up.length === devices.length ? `${up.length} devices connected` : `${up.length} of ${devices.length} devices connected`;
    const info = up[0]?.info;
    if (info) {
      facts.innerHTML = [
        ['Protocol', info.protocol],
        ['Tools', String(info.tools)],
        ['Resources', String(info.resources)],
        ['Prompts', String(info.prompts)],
      ]
        .map(([k, v]) => `<div><dt>${k}</dt><dd>${escapeHtml(v)}</dd></div>`)
        .join('');
    }
  };
  app.addEventListener('connected', refreshStatus);

  // ---------------------------------------------------------------- top bar actions
  const muteBtn = app.querySelector<HTMLButtonElement>('#mute')!;
  muteBtn.addEventListener('click', () => {
    setMuted(!isMuted());
    muteBtn.setAttribute('aria-pressed', String(isMuted()));
    muteBtn.innerHTML = `${icon(isMuted() ? 'mute' : 'volume', 18)}<span>${isMuted() ? 'Voice off' : 'Voice on'}</span>`;
  });
  app.querySelector('#clear')!.addEventListener('click', () => devices.forEach((d) => d.clearConversation()));

  // ---------------------------------------------------------------- demo clock (June's day)
  const setClock = config.demo ? mountDayClock(app, config, devices) : async () => undefined;
  app.querySelector('#reset')?.addEventListener('click', async () => {
    await fetch(`${config.demo!.url}/reset`, { method: 'POST' });
    await setClock(presets[0]?.time ?? '07:55');
    devices.forEach((d) => d.clearConversation());
    resetStory();
  });

  // ---------------------------------------------------------------- story rail
  const steps = [...app.querySelectorAll<HTMLElement>('.step')];
  const nextBtn = app.querySelector<HTMLButtonElement>('#next-step');
  let nextIndex = 0;
  let running = false;
  const updateNext = () => {
    steps.forEach((s, i) => s.classList.toggle('is-next', i === nextIndex && !running));
    if (!nextBtn) return;
    nextBtn.disabled = running || nextIndex >= story.length;
    nextBtn.querySelector('span')!.textContent = nextIndex >= story.length ? 'Story complete' : running ? 'Playing…' : `Play step ${nextIndex + 1}`;
  };
  const resetStory = () => {
    nextIndex = 0;
    steps.forEach((s) => s.classList.remove('is-done', 'is-running'));
    updateNext();
  };
  const runStep = async (i: number) => {
    if (running) return;
    const step: StoryStep = story[i];
    running = true;
    steps[i].classList.add('is-running');
    updateNext();
    try {
      if (step.time) await setClock(step.time);
      const target = devices.find((d) => d.cfg.id === step.device);
      if (target) {
        target.el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        if (step.say) await target.say(step.say);
      }
      steps[i].classList.add('is-done');
      nextIndex = Math.max(nextIndex, i + 1);
    } finally {
      steps[i].classList.remove('is-running');
      running = false;
      updateNext();
    }
  };
  steps.forEach((s, i) => s.querySelector('.step-run')!.addEventListener('click', () => void runStep(i)));
  nextBtn?.addEventListener('click', () => void runStep(nextIndex));
  updateNext();

  // Orchestrated entrance, once.
  requestAnimationFrame(() => document.body.classList.add('ready'));
  for (const d of devices) await d.connect();
  refreshStatus();
}

/** The "June's day" band: stops along the day, a sun that moves to the current time, sky that follows it. */
function mountDayClock(app: HTMLElement, config: CountertopConfig, devices: Device[]) {
  const url = config.demo!.url;
  const day = app.querySelector<HTMLElement>('.day')!;
  const readout = app.querySelector<HTMLOutputElement>('.clock-time')!;
  const stops = [...app.querySelectorAll<HTMLButtonElement>('.stop')];

  const show = (iso: string) => {
    const now = new Date(iso);
    const minutes = now.getHours() * 60 + now.getMinutes();
    readout.textContent = now.toLocaleTimeString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
    const t = dayFraction(minutes);
    const [a, b] = skyFor(minutes);
    // The orb rides the same quadratic curve the arc is drawn with (0,40 → 50,-8 → 100,40).
    const y = ((1 - t) ** 2 * 40 + 2 * t * (1 - t) * -8 + t ** 2 * 40) / 40;
    day.style.setProperty('--t', String(t));
    day.style.setProperty('--orb-y', String(y));
    day.style.setProperty('--sky-a', a);
    day.style.setProperty('--sky-b', b);
    day.dataset.night = String(minutes < 6.5 * 60 || minutes >= 21 * 60);
    let current = -1;
    stops.forEach((s, i) => {
      if (minutesOf(s.dataset.time!) <= minutes) current = i;
    });
    stops.forEach((s, i) => s.setAttribute('aria-current', String(i === current)));
    devices.forEach((d) => d.tickClock(now));
  };
  const post = (path: string, body: object) =>
    fetch(`${url}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then((r) => r.json())
      .then((s) => show(s.now));

  stops.forEach((b) => b.addEventListener('click', () => void post('clock', { time: b.dataset.time })));
  app.querySelector<HTMLButtonElement>('[data-advance]')?.addEventListener('click', (e) => {
    void post('clock', { advanceMinutes: Number((e.currentTarget as HTMLElement).dataset.advance) });
  });
  const poll = () =>
    fetch(`${url}/state`)
      .then((r) => r.json())
      .then((s) => show(s.now))
      .catch(() => (readout.textContent = 'Server offline'));
  void poll();
  setInterval(poll, 5000);
  return (time: string) => post('clock', { time });
}

void boot();
