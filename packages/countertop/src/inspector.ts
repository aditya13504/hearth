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
  if (entries.length > 400) entries.shift();
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
  if (m.error) return { label: `${method} ✕`, detail: m.error.message ?? '', kind: 'error' };
  let detail = '';
  if (method === 'initialize') detail = `protocol ${m.result?.protocolVersion}`;
  else if (method === 'tools/list') detail = `${m.result?.tools?.length} tools`;
  else if (method === 'tools/call') detail = m.result?.isError ? 'isError' : (m.result?.content?.[0]?.text ?? '').slice(0, 60);
  else if (method === 'elicitation/create') detail = m.result?.action ?? '';
  return { label: `${method} ✓`, detail, kind: 'response' };
}

export function mountInspector(container: HTMLElement) {
  container.innerHTML = `
    <div class="insp-head">
      <strong>MCP traffic</strong>
      <span class="insp-count"></span>
      <button class="insp-clear secondary small">Clear</button>
    </div>
    <div class="insp-list"></div>`;
  const list = container.querySelector<HTMLElement>('.insp-list')!;
  const count = container.querySelector<HTMLElement>('.insp-count')!;
  container.querySelector('.insp-clear')!.addEventListener('click', () => {
    entries.length = 0;
    render();
  });
  let rendered = 0;
  const render = () => {
    if (entries.length < rendered) {
      list.innerHTML = '';
      rendered = 0;
    }
    const stick = list.scrollTop + list.clientHeight >= list.scrollHeight - 30;
    for (const e of entries.slice(rendered)) {
      const s = summarize(e);
      const row = document.createElement('details');
      row.className = `insp-row ${s.kind} ${e.dir}`;
      row.innerHTML = `<summary><span class="t">${e.at.toLocaleTimeString([], { hour12: false })}</span><span class="dev">${e.device}</span><span class="dir">${e.dir === 'out' ? '→' : '←'}</span><span class="m">${escapeHtml(s.label)}</span><span class="d">${escapeHtml(s.detail)}</span></summary><pre></pre>`;
      row.addEventListener('toggle', () => {
        const pre = row.querySelector('pre')!;
        if (row.open && !pre.textContent) pre.textContent = JSON.stringify(e.message, null, 2);
      });
      list.appendChild(row);
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
