import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { startHearth } from '../src/index.js';

const PORT = 18787;
const URL_ = new URL(`http://localhost:${PORT}/mcp`);

let hearth: ReturnType<typeof startHearth>;

async function connect(token: string, opts: { elicit?: 'yes' | 'no' } = {}) {
  const client = new Client(
    { name: 'hearth-test', version: '1.0.0' },
    { capabilities: opts.elicit ? { elicitation: { form: {} } } : {} },
  );
  if (opts.elicit) {
    client.setRequestHandler('elicitation/create', async () => ({ action: 'accept', content: { confirm: opts.elicit === 'yes' } }));
  }
  await client.connect(new StreamableHTTPClientTransport(URL_, { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  return client;
}

const structured = (r: unknown) => (r as { structuredContent: Record<string, any> }).structuredContent;

beforeAll(() => {
  hearth = startHearth({ port: PORT, dataFile: null, demo: true, tickMs: 60_000 });
  hearth.clock.setTimeOfDay('07:50');
});
afterAll(async () => {
  await hearth.close();
});

describe('Hearth over Streamable HTTP', () => {
  it('negotiates MCP 2025-11-25 and advertises instructions + subscribe capability', async () => {
    const c = await connect('june-kitchen-echo');
    expect(c.getNegotiatedProtocolVersion()).toBe('2025-11-25');
    expect(c.getInstructions()).toContain('voice');
    expect(c.getServerCapabilities()?.resources?.subscribe).toBe(true);
    await c.close();
  });

  it('rejects unknown device tokens', async () => {
    await expect(connect('stranger')).rejects.toThrow();
  });

  it('lists tools with MCP Apps UI metadata', async () => {
    const c = await connect('june-kitchen-echo');
    const { tools } = await c.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['get_today', 'log_dose', 'order_refill', 'care_summary', 'medication_info', 'log_checkin']));
    const today = tools.find((t) => t.name === 'get_today')!;
    expect((today._meta as any)?.ui?.resourceUri).toBe('ui://hearth/today.html');
    const { resources } = await c.listResources();
    expect(resources.map((r) => r.uri)).toEqual(expect.arrayContaining(['hearth://inbox', 'ui://hearth/today.html']));
    await c.close();
  });

  it('logs a dose for June and Maya sees it, with double-dose protection', async () => {
    const june = await connect('june-kitchen-echo');
    const maya = await connect('maya-phone');
    const first = structured(await june.callTool({ name: 'log_dose', arguments: { medication: 'the pink one' } }));
    expect(first).toMatchObject({ logged: true, medication: 'Lisinopril', slot: '08:00' });
    const again = await maya.callTool({ name: 'log_dose', arguments: { medication: 'lisinopril' } });
    expect(structured(again).logged).toBe(false);
    expect(JSON.stringify(again.content)).toContain('already taken');
    const today = structured(await maya.callTool({ name: 'get_today', arguments: {} }));
    expect(today.entries.find((e: any) => e.medication === 'Lisinopril').state).toBe('taken');
    await june.close();
    await maya.close();
  });

  it('logs every due dose for "my morning pills"', async () => {
    hearth.clock.setTimeOfDay('08:10');
    const june = await connect('june-kitchen-echo');
    await june.callTool({ name: 'log_dose', arguments: { medication: 'lisinopril' } }); // may already be taken; either way it is taken now
    const res = structured(await june.callTool({ name: 'log_dose', arguments: { medication: 'my morning pills' } }));
    // Only doses still open are logged — the Lisinopril already taken is never logged twice.
    expect(res.results.map((r: any) => r.medication)).toEqual(['Metformin']);
    expect(res.results[0].logged).toBe(true);
    hearth.clock.setTimeOfDay('07:50');
    await june.close();
  });

  it('pushes notifications/resources/updated to a subscribed caregiver when June reports a fall', async () => {
    const maya = await connect('maya-phone');
    const updated = new Promise<string>((resolve) => maya.setNotificationHandler('notifications/resources/updated', (n) => resolve(n.params.uri)));
    await maya.subscribeResource({ uri: 'hearth://inbox' });
    const june = await connect('june-kitchen-echo');
    const res = structured(await june.callTool({ name: 'log_checkin', arguments: { mood: 'okay', note: 'I fell getting out of the chair' } }));
    expect(res.familyAlerted).toBe(true);
    await expect(updated).resolves.toBe('hearth://inbox');
    const inbox = await maya.readResource({ uri: 'hearth://inbox' });
    expect((inbox.contents[0] as any).text).toContain('fall');
    await june.close();
    await maya.close();
  });

  it('orders a refill only after the user confirms through elicitation', async () => {
    const declining = await connect('june-kitchen-echo', { elicit: 'no' });
    const no = structured(await declining.callTool({ name: 'order_refill', arguments: { medication: 'metformin' } }));
    expect(no.status).toBe('declined');
    await declining.close();

    const accepting = await connect('june-kitchen-echo', { elicit: 'yes' });
    const yes = structured(await accepting.callTool({ name: 'order_refill', arguments: { medication: 'metformin' } }));
    expect(yes).toMatchObject({ status: 'placed', medication: 'Metformin', quantity: 60 });
    await accepting.close();
  });

  it('falls back to a pending order + confirm_refill without elicitation support', async () => {
    const c = await connect('maya-phone');
    const quote = structured(await c.callTool({ name: 'order_refill', arguments: { medication: 'atorvastatin' } }));
    expect(quote.status).toBe('pending');
    const placed = structured(await c.callTool({ name: 'confirm_refill', arguments: { order_id: quote.orderId, confirm: true } }));
    expect(placed.status).toBe('placed');
    await c.close();
  });

  it('serves the caregiver summary and prompts', async () => {
    const c = await connect('maya-phone');
    const s = structured(await c.callTool({ name: 'care_summary', arguments: { days: 7 } }));
    expect(s.person).toBe('June');
    expect(s.adherence.percent).toBeGreaterThan(0);
    const { prompts } = await c.listPrompts();
    expect(prompts.map((p) => p.name)).toEqual(expect.arrayContaining(['morning_checkin', 'caregiver_briefing']));
    await c.close();
  });
});
