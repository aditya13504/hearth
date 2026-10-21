import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { startHearth } from '../src/index.js';
import { createHousehold } from '../src/setup.js';
import { Store } from '../src/store.js';

const PORT = 18788;
const dir = mkdtempSync(join(tmpdir(), 'hearth-prod-'));
const file = join(dir, 'household.json');
let tokens: { recipient: string; caregiver: string };
let hearth: ReturnType<typeof startHearth>;

const init = (token: string, origin?: string) =>
  fetch(`http://localhost:${PORT}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}`,
      ...(origin ? { origin } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't', version: '1' } } }),
  });

beforeAll(() => {
  const result = createHousehold({ file, household: 'Lee family', recipient: 'Ruth:Mom', caregivers: ['Sam:son'] });
  tokens = { recipient: result.tokens[0].token, caregiver: result.tokens[1].token };
  hearth = startHearth({ port: PORT, dataFile: file, mode: 'production', tickMs: 60_000 });
});
afterAll(async () => {
  await hearth.close();
});

describe('setup', () => {
  it('stores only token hashes, never the tokens themselves', () => {
    const raw = readFileSync(file, 'utf8');
    expect(raw).not.toContain(tokens.recipient);
    expect(raw).not.toContain(tokens.caregiver);
    expect(raw).toContain('sha256:');
    expect(tokens.recipient).toMatch(/^hth_[A-Za-z0-9_-]{40,}$/);
  });

  it('refuses to add a real household to a demo data file', () => {
    const demoFile = join(dir, 'demo.json');
    new Store(demoFile, new Date(), 'demo');
    expect(() => createHousehold({ file: demoFile, household: 'X', recipient: 'A', caregivers: ['B'] })).toThrow(/demo data/);
  });
});

describe('production store', () => {
  it('never regenerates real data, even on another day', () => {
    const later = new Date(Date.now() + 5 * 86_400_000);
    const store = new Store(file, later, 'production');
    expect(store.db.households.map((h) => h.name)).toContain('Lee family');
    expect(() => store.reset(later)).toThrow(/Refusing/);
  });

  it('will not start without a household, and will not mix demo and real data', () => {
    expect(() => new Store(join(dir, 'missing.json'), new Date(), 'production')).toThrow(/npm run setup/);
    expect(() => new Store(file, new Date(), 'demo')).toThrow(/real household data/);
  });
});

describe('production server', () => {
  it('accepts the family’s own device tokens and binds the session to that person', async () => {
    const client = new Client({ name: 'prod-test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://localhost:${PORT}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${tokens.caregiver}` } } }));
    expect(client.getNegotiatedProtocolVersion()).toBe('2025-11-25');
    const who = (await client.callTool({ name: 'who_am_i', arguments: {} })).structuredContent as Record<string, string>;
    expect(who).toMatchObject({ name: 'Sam', role: 'caregiver', household: 'Lee family' });
    const today = (await client.callTool({ name: 'get_today', arguments: {} })).structuredContent as { entries: unknown[] };
    expect(today.entries).toEqual([]); // a new household starts with no medicines
    await client.close();
  });

  it('rejects the demo household’s tokens', async () => {
    expect((await init('maya-phone')).status).toBe(401);
  });

  it('has no demo clock controls', async () => {
    expect((await fetch(`http://localhost:${PORT}/demo/state`)).status).toBe(404);
  });

  it('refuses browser requests from untrusted websites but allows localhost', async () => {
    expect((await init(tokens.recipient, 'https://evil.example')).status).toBe(403);
    expect((await init(tokens.recipient, 'http://localhost:5173')).status).toBe(200);
  });
});
