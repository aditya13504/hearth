import { App } from '@modelcontextprotocol/ext-apps/app-with-deps';
import './style.css';

export type Structured = Record<string, any>;

/**
 * Connects a view to its host and calls `render` with the tool's structuredContent
 * whenever a result arrives. Also follows the host's light/dark theme.
 */
export async function mountView(name: string, render: (data: Structured, app: App) => void): Promise<App> {
  const app = new App({ name: `hearth-${name}`, version: '0.1.0' }, {}, { autoResize: true });
  const applyTheme = (theme?: string) => {
    if (theme) document.documentElement.dataset.theme = theme;
  };
  app.ontoolresult = (params) => {
    if (params.structuredContent) render(params.structuredContent as Structured, app);
  };
  app.onhostcontextchanged = (ctx) => applyTheme(ctx.theme);
  await app.connect();
  applyTheme(app.getHostContext()?.theme);
  return app;
}

export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** A small pill drawn in the colour the label describes, so June can match the card to the bottle. */
export function pill(looks: string): string {
  const l = looks.toLowerCase();
  const fill = l.includes('pink') ? '#f4a7b9' : l.includes('yellow') ? '#f6d365' : l.includes('blue') ? '#9cc3f0' : '#f5f1ea';
  const oval = l.includes('oval') || l.includes('capsule');
  return oval
    ? `<svg width="40" height="24" viewBox="0 0 40 24" aria-hidden="true"><rect x="1" y="1" width="38" height="22" rx="11" fill="${fill}" stroke="#bfae9f"/><line x1="20" y1="4" x2="20" y2="20" stroke="#bfae9f"/></svg>`
    : `<svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true"><circle cx="15" cy="15" r="13" fill="${fill}" stroke="#bfae9f"/></svg>`;
}
