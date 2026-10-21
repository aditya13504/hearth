/**
 * Protocol inspector: every JSON-RPC message between each simulated device and its MCP server,
 * in both directions, so a developer (or a judge) can see exactly what the assistant did.
 */
export interface LogEntry {
  at: Date;
  device: string;
  dir: 'out' | 'in';
  message: any;
}

const entries: LogEntry[] = [];
const listeners = new Set<() => void>();
const pendingMethods = new Map<string, string>();

export function log(device: string, dir: 'out' | 'in', message: any) {
  if (message?.method && message.id !== undefined) pendingMethods.set(`${device}:${dir === 'out' ? 'c' : 's'}:${message.id}`, message.method);
  entries.push({ at: new Date(), device, dir, message });
  if (entries.length > 500) entries.shift();
  listeners.forEach((l) => l());
}

export function summarize(e: LogEntry): { label: string; detail: string; kind: 'request' | 'response' | 'notification' | 'error' } {
  const m = e.message;
  if (m.method && m.id !== undefined) {
    const detail = m.method === 'tools/call' ? m.params?.name : m.method === 'resources/read' || m.method === 'resources/subscribe' ? m.params?.uri : '';
    return { label: m.method, detail: detail ?? '', kind: 'request' };
  }
  if (m.method) return { label: m.method, detail: m.params?.uri ?? '', kind: 'notification' };
  // Response: find which request it answers. Responses travel opposite to their request.
  const origin = e.dir === 'in' ? 'c' : 's';
  const method = pendingMethods.get(`${e.device}:${origin}:${m.id}`) ?? 'response';
  if (m.error) return { label: `${method} failed`, detail: m.error.message ?? '', kind: 'error' };
  let detail = '';
  if (method === 'initialize') detail = `protocol ${m.result?.protocolVersion}`;
  else if (method === 'tools/list') detail = `${m.result?.tools?.length} tools`;
  else if (method === 'tools/call') detail = m.result?.isError ? 'tool reported an error' : (m.result?.content?.[0]?.text ?? '').slice(0, 90);
  else if (method === 'elicitation/create') detail = `answered: ${m.result?.action ?? ''}`;
  return { label: `${method} result`, detail, kind: 'response' };
}

export function mountInspector(container: HTMLElement, devices: Array<{ id: string; label: string }>) {
  let filter = 'all';
  container.innerHTML = `
    <div class="console-bar">
      <div class="console-filters" role="tablist" aria-label="Show traffic for">
        <button role="tab" class="seg" data-filter="all" aria-selected="true">All devices</button>
        ${devices.map((d) => `<button role="tab" class="seg" data-filter="${d.id}" aria-selected="false">${escapeHtml(d.label)}</button>`).join('')}
      </div>
      <div class="console-legend">
        <span><b class="dir out">→</b> device to server</span>
        <span><b class="dir in">←</b> server to device</span>
        <span class="console-count"></span>
        <button class="btn btn-ghost small console-clear" type="button">Clear</button>
      </div>
    </div>
    <div class="console-list" tabindex="0" aria-label="MCP messages"></div>`;
  const list = container.querySelector<HTMLElement>('.console-list')!;
  const count = container.querySelector<HTMLElement>('.console-count')!;
  container.querySelector('.console-clear')!.addEventListener('click', () => {
    entries.length = 0;
    list.innerHTML = '';
    rendered = 0;
    render();
  });
  container.querySelectorAll<HTMLButtonElement>('.seg').forEach((b) =>
    b.addEventListener('click', () => {
      filter = b.dataset.filter!;
      container.querySelectorAll('.seg').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
      list.querySelectorAll<HTMLElement>('.row').forEach((r) => (r.hidden = filter !== 'all' && r.dataset.device !== filter));
    }),
  );

  let rendered = 0;
  const render = () => {
    if (entries.length < rendered) {
      list.innerHTML = '';
      rendered = 0;
    }
    const stick = list.scrollTop + list.clientHeight >= list.scrollHeight - 40;
    for (const e of entries.slice(rendered)) {
      const s = summarize(e);
      const row = document.createElement('details');
      row.className = `row ${s.kind} ${e.dir} fresh`;
      row.dataset.device = e.device;
      row.hidden = filter !== 'all' && e.device !== filter;
      row.innerHTML = `<summary>
          <time>${e.at.toLocaleTimeString([], { hour12: false })}</time>
          <span class="who">${escapeHtml(e.device)}</span>
          <b class="dir ${e.dir}">${e.dir === 'out' ? '→' : '←'}</b>
          <span class="method">${escapeHtml(s.label)}</span>
          <span class="detail">${escapeHtml(s.detail)}</span>
        </summary><pre></pre>`;
      row.addEventListener('toggle', () => {
        const pre = row.querySelector('pre')!;
        if (row.open && !pre.textContent) pre.textContent = JSON.stringify(e.message, null, 2);
      });
      list.appendChild(row);
      setTimeout(() => row.classList.remove('fresh'), 1600);
    }
    rendered = entries.length;
    count.textContent = `${entries.length} messages`;
    if (stick) list.scrollTop = list.scrollHeight;
  };
  listeners.add(render);
  render();
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
