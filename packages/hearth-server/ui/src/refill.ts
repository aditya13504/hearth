import type { App } from '@modelcontextprotocol/ext-apps/app-with-deps';
import { esc, mountView, type Structured } from './common';

const root = document.getElementById('root')!;
const STATUS: Record<string, [string, string]> = {
  pending: ['Waiting for your OK', 'due'],
  placed: ['Ordered', 'taken'],
  declined: ['Not ordered', 'upcoming'],
};

function render(o: Structured, app: App) {
  const [label, cls] = STATUS[o.status] ?? ['', 'upcoming'];
  const eta = o.eta ? new Date(`${o.eta}T12:00:00`).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' }) : null;
  root.innerHTML = `
    <div class="receipt panel">
      <header>
        <div><h1>${esc(o.medication)} refill</h1><div class="sub">${esc(o.pharmacy)}</div></div>
        <span class="badge ${cls}">${label}</span>
      </header>
      <div class="line"><span>${esc(o.medication)} ${esc(o.strength)}</span><span>${o.quantity} tablets</span></div>
      <div class="line"><span>Delivery</span><span>${eta ? `Arrives ${esc(eta)}` : esc(o.delivery)}</span></div>
      <div class="line total"><span>Total</span><span>$${Number(o.price).toFixed(2)}</span></div>
      ${
        o.status === 'pending'
          ? `<div style="display:flex;gap:10px;margin-top:12px"><button id="yes">Place order</button><button id="no" class="secondary">Cancel</button></div>`
          : ''
      }
      <div class="note">Simulated pharmacy for this demo — no real order or payment is made. Order ${esc(o.orderId)}.</div>
    </div>`;

  const decide = async (confirm: boolean) => {
    const res = await app.callServerTool({ name: 'confirm_refill', arguments: { order_id: o.orderId, confirm } });
    if (res.structuredContent) render(res.structuredContent as Structured, app);
  };
  root.querySelector('#yes')?.addEventListener('click', () => decide(true));
  root.querySelector('#no')?.addEventListener('click', () => decide(false));
}

void mountView('refill', render);
