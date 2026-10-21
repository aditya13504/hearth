/** Inline SVG icons (24px grid, currentColor) so the page needs no icon font. */
const PATHS: Record<string, string> = {
  hearth:
    '<path d="M12 3.2 3.5 10v10.3h6.2v-5.6h4.6v5.6h6.2V10Z" fill="currentColor" opacity=".18"/><path d="M12 3.2 3.5 10v10.3h6.2v-5.6h4.6v5.6h6.2V10Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 8.6c1.4 1.5 2.1 2.6 2.1 3.6a2.1 2.1 0 0 1-4.2 0c0-1 .7-2.1 2.1-3.6Z" fill="currentColor"/>',
  mic: '<path fill="currentColor" d="M12 14.5a3.5 3.5 0 0 0 3.5-3.5V5.5a3.5 3.5 0 0 0-7 0V11a3.5 3.5 0 0 0 3.5 3.5Zm6-3.5a6 6 0 0 1-12 0H4.2a7.8 7.8 0 0 0 6.9 7.7V21h1.8v-2.3a7.8 7.8 0 0 0 6.9-7.7Z"/>',
  bolt: '<path fill="currentColor" d="M13.2 2 4.5 13.4h6.1L9.8 22l8.7-11.4h-6.1Z"/>',
  bell: '<path fill="currentColor" d="M12 22a2.4 2.4 0 0 0 2.4-2.4H9.6A2.4 2.4 0 0 0 12 22Zm7.2-6V11a7.2 7.2 0 0 0-5.4-7V3.2a1.8 1.8 0 0 0-3.6 0V4a7.2 7.2 0 0 0-5.4 7v5L3 17.8v.9h18v-.9Z"/>',
  alert: '<path fill="currentColor" d="M12 2 1.5 20.5h21Zm1.1 15.2h-2.2V15h2.2Zm0-4.2h-2.2V8.6h2.2Z"/>',
  check: '<path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" d="m5 12.5 4.3 4.3L19 7.2"/>',
  play: '<path fill="currentColor" d="M8 5.2v13.6L19 12Z"/>',
  volume: '<path fill="currentColor" d="M4 9.2v5.6h3.7L12.4 19V5L7.7 9.2Zm11.6 2.8a4.2 4.2 0 0 0-2.3-3.8v7.6a4.2 4.2 0 0 0 2.3-3.8Zm-2.3-8.5v1.9a7 7 0 0 1 0 13.2v1.9a8.9 8.9 0 0 0 0-17Z"/>',
  mute: '<path fill="currentColor" d="M4 9.2v5.6h3.7L12.4 19V5L7.7 9.2Zm16.5.3-1.3-1.3-2.4 2.5-2.4-2.5-1.3 1.3 2.4 2.5-2.4 2.5 1.3 1.3 2.4-2.5 2.4 2.5 1.3-1.3-2.4-2.5Z"/>',
  reset: '<path fill="currentColor" d="M12 5V1.8L7.6 6.2 12 10.6V7.4a5.6 5.6 0 1 1-5.6 5.6H4a8 8 0 1 0 8-8Z"/>',
  github:
    '<path fill="currentColor" d="M12 1.8a10.2 10.2 0 0 0-3.2 19.9c.5.1.7-.2.7-.5v-1.8c-2.8.6-3.4-1.3-3.4-1.3-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.6 2.4 1.1 3 .9.1-.7.4-1.1.6-1.4-2.3-.3-4.7-1.1-4.7-5 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.8 0 0 .9-.3 2.8 1a9.6 9.6 0 0 1 5.1 0c1.9-1.3 2.8-1 2.8-1 .6 1.5.2 2.5.1 2.8.6.7 1 1.6 1 2.7 0 3.9-2.4 4.7-4.7 5 .4.3.7.9.7 1.9v2.8c0 .3.2.6.7.5A10.2 10.2 0 0 0 12 1.8Z"/>',
  server:
    '<path fill="currentColor" d="M4 3.5h16a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1Zm0 10h16a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1ZM6.5 6a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm0 10a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z"/>',
  display:
    '<path fill="currentColor" d="M3 4.5h18a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-6.2l1.7 2.7v.8H7.5v-.8l1.7-2.7H3a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1Zm1 2v9h16v-9Z"/>',
  phone: '<path fill="currentColor" d="M7.5 1.8h9a1.8 1.8 0 0 1 1.8 1.8v16.8a1.8 1.8 0 0 1-1.8 1.8h-9a1.8 1.8 0 0 1-1.8-1.8V3.6a1.8 1.8 0 0 1 1.8-1.8Zm.2 3v13.8h8.6V4.8ZM12 19.5a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8Z"/>',
  skill: '<path fill="currentColor" d="M6 2.5h9l4 4v15H6a1 1 0 0 1-1-1v-17a1 1 0 0 1 1-1Zm8 1.4v3.6h3.6ZM8 11v1.8h8V11Zm0 4v1.8h8V15Z"/>',
};

export function icon(name: keyof typeof PATHS | string, size = 20): string {
  return `<svg class="icon icon-${name}" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${PATHS[name] ?? ''}</svg>`;
}
