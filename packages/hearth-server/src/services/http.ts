import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

/**
 * GET JSON with a timeout and a small on-disk cache. Public health APIs are free but not
 * always fast; a voice assistant cannot leave someone waiting, and a demo cannot depend on
 * conference Wi-Fi. Cached responses are served when the network is slow or down.
 */
export async function cachedJson<T>(url: string, cacheDir: string, timeoutMs = 6000): Promise<T | null> {
  const key = createHash('sha1').update(url).digest('hex').slice(0, 16);
  const file = join(cacheDir, `${key}.json`);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': 'hearth-mcp/0.1' } });
    if (res.status === 404) return null; // openFDA uses 404 for "no matches"
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as T;
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(file, JSON.stringify({ url, body }));
    return body;
  } catch (err) {
    if (existsSync(file)) return (JSON.parse(readFileSync(file, 'utf8')) as { body: T }).body;
    throw err;
  }
}
