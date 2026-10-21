// Builds each MCP Apps view into one self-contained HTML file (ui-dist/<view>.html).
// MCP Apps hosts render views from a single resource, so scripts and styles are inlined.
import { build } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const views = ['today', 'summary', 'refill'];

for (const [i, view] of views.entries()) {
  await build({
    root,
    logLevel: 'warn',
    plugins: [viteSingleFile()],
    build: {
      outDir: resolve(root, '../ui-dist'),
      emptyOutDir: i === 0,
      rollupOptions: { input: resolve(root, `${view}.html`) },
    },
  });
  console.log(`built ui-dist/${view}.html`);
}
