import type { App } from '@modelcontextprotocol/ext-apps/app-with-deps';
import { esc, mountView, type Structured } from './common';

const root = document.getElementById('root')!;
const MOOD_LABEL: Record<string, string> = { great: 'Great', good: 'Good', okay: 'Okay', not_great: 'Not great', bad: 'Bad' };
const slotTime = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
};
const weekday = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString([], { weekday: 'short' });

/** Daily adherence as columns: filled height = share of doses taken. */
function adherenceBars(perDay: Structured[]): string {
  const w = 300;
  const h = 90;
  const bw = w / perDay.length;
  return `<svg viewBox="0 0 ${w} ${h + 22}" width="100%" role="img" aria-label="Doses taken per day">
    ${perDay
      .map((d, i) => {
        const share = d.expected ? d.taken / d.expected : 1;
        const bh = Math.max(4, share * h);
        const color = d.expected === 0 ? 'var(--line)' : share === 1 ? 'var(--ok)' : share >= 0.75 ? 'var(--warn)' : 'var(--bad)';
        return `<rect x="${i * bw + 6}" y="${h - bh}" width="${bw - 12}" height="${bh}" rx="6" fill="${color}"/>
          <text x="${i * bw + bw / 2}" y="${h + 17}" text-anchor="middle" font-size="12" fill="var(--muted)">${weekday(d.day)}</text>`;
      })
      .join('')}
  </svg>`;
}

/** Mood from check-ins on a 1–5 scale. */
function moodLine(mood: Structured[]): string {
  if (mood.length < 2) return '<div class="empty">Not enough check-ins yet.</div>';
  const w = 300;
  const h = 80;
  const x = (i: number) => 10 + (i * (w - 20)) / (mood.length - 1);
  const y = (s: number) => h - ((s - 1) / 4) * (h - 10) - 5;
  const pts = mood.map((m, i) => `${x(i)},${y(m.score)}`).join(' ');
  return `<svg viewBox="0 0 ${w} ${h + 22}" width="100%" role="img" aria-label="Mood over the week">
    <polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linejoin="round"/>
    ${mood
      .map(
        (m, i) => `<circle cx="${x(i)}" cy="${y(m.score)}" r="6" fill="${m.flags?.length ? 'var(--bad)' : 'var(--accent)'}"><title>${esc(MOOD_LABEL[m.mood])}${m.note ? `: ${esc(m.note)}` : ''}</title></circle>
        <text x="${x(i)}" y="${h + 17}" text-anchor="middle" font-size="12" fill="var(--muted)">${weekday(m.day)}</text>`,
      )
      .join('')}
  </svg>`;
}

function render(s: Structured, app: App) {
  const a = s.adherence;
  const latest = s.mood?.at(-1);
  const low = (s.refills ?? []).filter((r: Structured) => r.needsRefill);
  const alerts: Structured[] = s.openAlerts ?? [];
  root.innerHTML = `
    <header>
      <div><h1>How ${esc(s.person)} is doing</h1><div class="sub">Last ${s.days} days</div></div>
      ${alerts.length ? `<span class="badge missed">${alerts.length} open alert${alerts.length > 1 ? 's' : ''}</span>` : '<span class="badge taken">All clear</span>'}
    </header>
    <div class="grid2">
      <div class="panel">
        <h2>Medicines taken</h2>
        <div class="big">${a.percent}%</div>
        <div class="sub">${a.taken} of ${a.expected} doses</div>
      </div>
      <div class="panel"><h2>By day</h2>${adherenceBars(a.perDay)}</div>
      <div class="panel">
        <h2>Latest check-in</h2>
        <div class="name">${latest ? esc(MOOD_LABEL[latest.mood]) : '—'}</div>
        <div class="meta">${latest?.note ? `“${esc(latest.note)}”` : ''}</div>
      </div>
      <div class="panel"><h2>Mood</h2>${moodLine(s.mood ?? [])}</div>
    </div>
    <div class="grid2" style="margin-top:16px">
      <div class="panel" style="grid-column:1/-1">
        <h2>Needs attention</h2>
        ${alerts.map((x) => `<div class="item"><div><div class="name" style="font-size:17px">${esc(x.title)}</div><div class="meta">${esc(x.detail)}</div></div><span class="badge ${x.severity === 'urgent' ? 'missed' : 'due'}">${esc(x.severity)}</span></div>`).join('')}
        ${a.missedDoses.map((m: Structured) => `<div class="item"><div>Missed ${esc(m.medication)} · ${esc(weekday(m.day))} ${esc(slotTime(m.slot))}</div><span class="badge missed">missed</span></div>`).join('')}
        ${low.map((r: Structured) => `<div class="item"><div>${esc(r.medication)} runs out in ${r.daysLeft} days</div><button data-med="${esc(r.medication)}">Order refill</button></div>`).join('')}
        ${!alerts.length && !a.missedDoses.length && !low.length ? '<div class="empty">Nothing needs attention.</div>' : ''}
      </div>
    </div>`;

  root.querySelectorAll<HTMLButtonElement>('button[data-med]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      // Hand the request back to the assistant so the purchase goes through its spoken confirmation.
      await app.sendMessage({ role: 'user', content: [{ type: 'text', text: `Order a refill of ${btn.dataset.med}.` }] });
    }),
  );
}

void mountView('summary', render);
