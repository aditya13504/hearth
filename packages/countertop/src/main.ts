import './styles.css';
import { Device } from './device';
import { mountInspector } from './inspector';
import type { CountertopConfig } from './types';
import { configureVoice, isMuted, setMuted } from './voice';

async function boot() {
  const config: CountertopConfig = await fetch('/api/config').then((r) => r.json());
  configureVoice(config.voice?.preferred);
  document.title = config.title;

  const app = document.getElementById('app')!;
  app.innerHTML = `
    <header class="top">
      <div class="brand">
        <div class="logo" aria-hidden="true">◐</div>
        <div><div class="title">${config.title}</div><div class="subtitle">${config.subtitle ?? 'Voice assistant simulator for MCP servers'}</div></div>
      </div>
      <div class="top-actions">
        <span class="pill ${config.llm.configured ? '' : 'bad'}" title="Model behind the assistant">${config.llm.configured ? config.llm.model : 'LLM_API_KEY missing'}</span>
        <button class="secondary small" id="mute">${isMuted() ? 'Unmute voice' : 'Mute voice'}</button>
        <button class="secondary small" id="clear">New conversation</button>
        <button class="secondary small" id="toggle-insp">Hide MCP traffic</button>
      </div>
    </header>
    ${
      config.demo
        ? `<div class="demo-bar">
            <span class="demo-label">Demo clock</span>
            <span class="demo-time">--:--</span>
            ${config.demo.presets.map((p) => `<button class="secondary small" data-time="${p.time}">${p.label}</button>`).join('')}
            <button class="secondary small" data-advance="15">+15 min</button>
            <button class="secondary small" data-advance="60">+1 hour</button>
            <button class="secondary small danger" id="reset-data">Reset demo data</button>
          </div>`
        : ''
    }
    <main class="devices"></main>
    <section class="inspector"></section>`;

  const devices = config.devices.map((d) => new Device(d, config));
  const container = app.querySelector('.devices')!;
  devices.forEach((d) => container.appendChild(d.el));
  mountInspector(app.querySelector('.inspector')!);

  app.querySelector('#mute')!.addEventListener('click', (e) => {
    setMuted(!isMuted());
    (e.target as HTMLButtonElement).textContent = isMuted() ? 'Unmute voice' : 'Mute voice';
  });
  app.querySelector('#clear')!.addEventListener('click', () => devices.forEach((d) => d.clearConversation()));
  app.querySelector('#toggle-insp')!.addEventListener('click', (e) => {
    const hidden = document.body.classList.toggle('no-inspector');
    (e.target as HTMLButtonElement).textContent = hidden ? 'Show MCP traffic' : 'Hide MCP traffic';
  });

  if (config.demo) {
    const demoUrl = config.demo.url;
    const timeEl = app.querySelector<HTMLElement>('.demo-time')!;
    const show = (iso: string) => {
      const now = new Date(iso);
      timeEl.textContent = now.toLocaleTimeString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
      devices.forEach((d) => d.tickClock(now));
    };
    const post = (path: string, body: object) =>
      fetch(`${demoUrl}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
        .then((r) => r.json())
        .then((s) => show(s.now));
    app.querySelectorAll<HTMLButtonElement>('[data-time]').forEach((b) => b.addEventListener('click', () => post('clock', { time: b.dataset.time })));
    app.querySelectorAll<HTMLButtonElement>('[data-advance]').forEach((b) =>
      b.addEventListener('click', () => post('clock', { advanceMinutes: Number(b.dataset.advance) })),
    );
    app.querySelector('#reset-data')!.addEventListener('click', async () => {
      await post('reset', {});
      devices.forEach((d) => d.clearConversation());
    });
    const poll = () =>
      fetch(`${demoUrl}/state`)
        .then((r) => r.json())
        .then((s) => show(s.now))
        .catch(() => (timeEl.textContent = 'server offline'));
    void poll();
    setInterval(poll, 5000);
  }

  for (const d of devices) await d.connect();
}

void boot();
