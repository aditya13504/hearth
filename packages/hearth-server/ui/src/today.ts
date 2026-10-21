import type { App } from '@modelcontextprotocol/ext-apps/app-with-deps';
import { clock, esc, mountView, pill, type Structured } from './common';

const root = document.getElementById('root')!;
const LABEL: Record<string, string> = { taken: 'Taken', skipped: 'Skipped', missed: 'Missed', due: 'Due now', upcoming: 'Later' };

function render(data: Structured, app: App) {
  const day = new Date(data.now).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  const entries: Structured[] = data.entries ?? [];
  const done = entries.filter((e) => e.state === 'taken').length;
  root.innerHTML = `
    <header>
      <div><h1>${esc(data.person)}'s medicines</h1><div class="sub">${esc(day)}</div></div>
      <div class="sub">${done} of ${entries.length} taken</div>
    </header>
    <div class="list">
      ${entries
        .map(
          (e, i) => `
        <div class="row ${e.state}">
          <div class="time">${esc(e.spokenTime)}</div>
          <div>${pill(e.looks)}</div>
          <div>
            <div class="name">${esc(e.medication)} <span class="meta">${esc(e.strength)}</span></div>
            <div class="meta">${esc(e.purpose)} · ${esc(e.looks)}${e.instructions ? ` · ${esc(e.instructions)}` : ''}</div>
          </div>
          <div>${
            e.state === 'due' || e.state === 'missed'
              ? `<button data-i="${i}">I took it</button>`
              : `<span class="badge ${e.state}">${LABEL[e.state]}${e.loggedAt ? ` ${clock(e.loggedAt)}` : ''}${e.loggedBy ? ` · ${esc(e.loggedBy)}` : ''}</span>`
          }</div>
        </div>`,
        )
        .join('')}
    </div>`;

  root.querySelectorAll<HTMLButtonElement>('button[data-i]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const e = entries[Number(btn.dataset.i)];
      btn.disabled = true;
      btn.textContent = 'Saving…';
      // The view calls the MCP server directly through the host — no round trip through the model.
      await app.callServerTool({ name: 'log_dose', arguments: { medication: e.medication, slot: e.slot, status: 'taken' } });
      const fresh = await app.callServerTool({ name: 'get_today', arguments: {} });
      if (fresh.structuredContent) render(fresh.structuredContent as Structured, app);
    });
  });
}

void mountView('today', render);
