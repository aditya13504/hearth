import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/server';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import * as z from 'zod/v4';
import { CareService, memberLabel } from './care.js';
import { speakTime } from './clock.js';
import type { Household, Medication, Member, Order } from './store.js';
import type { OpenFda } from './services/openfda.js';
import type { RxNorm } from './services/rxnorm.js';

export const INBOX_URI = 'hearth://inbox';
export const PROFILE_URI = 'hearth://household/profile';
export const UI = {
  today: 'ui://hearth/today.html',
  summary: 'ui://hearth/summary.html',
  refill: 'ui://hearth/refill.html',
} as const;

export interface HearthDeps {
  care: CareService;
  rx: RxNorm;
  fda: OpenFda;
  /** Directory containing the built MCP Apps views (today.html, summary.html, refill.html). */
  uiDir: string;
}

export interface SessionIdentity {
  householdId: string;
  memberId: string;
}

export const SERVER_INSTRUCTIONS = `Hearth is a care companion for an older adult living at home and the family members who look out for them.
It is used by voice (Alexa+ style). Keep spoken replies to one or two short sentences, warm and plain, never clinical.
- Always say medication names together with what they look like ("your Metformin, the large white oval one").
- Before anything irreversible (ordering a refill), the server asks for confirmation; never claim an order was placed unless the tool says so.
- Medication facts come only from medication_info, which quotes the FDA label. Say "according to the FDA label". Never give dosing advice, never suggest skipping, doubling or changing a dose — suggest calling the prescriber or pharmacist instead.
- If someone mentions a fall, chest pain, trouble breathing or confusion, log it with log_checkin (the family is alerted automatically) and tell them to call 911 if it is an emergency.
- The caller's identity and role are already known from the device; use who_am_i if unsure. Caregivers see the whole household; recipients see their own day.`;

const text = (t: string) => [{ type: 'text' as const, text: t }];

function loadView(uiDir: string, file: string): string {
  const path = join(uiDir, file);
  if (existsSync(path)) return readFileSync(path, 'utf8');
  return `<!doctype html><html><body style="font-family:system-ui;padding:16px">View <b>${file}</b> has not been built yet. Run <code>npm run build:ui</code>.</body></html>`;
}

/**
 * Builds one MCP server instance bound to the person on the other end of the session.
 * Alexa+ resolves "who is speaking" before calling an add-on; here the device's bearer token does that.
 */
export function createHearthServer(deps: HearthDeps, id: SessionIdentity) {
  const { care, rx, fda } = deps;
  const household = (): Household => care.store.household(id.householdId);
  const me = (): Member => household().members.find((m) => m.id === id.memberId)!;
  const recipient = (): Member => household().members.find((m) => m.role === 'recipient')!;
  const subscriptions = new Set<string>();

  const server = new McpServer(
    { name: 'hearth', title: 'Hearth care companion', version: '0.1.0' },
    {
      instructions: SERVER_INSTRUCTIONS,
      capabilities: { resources: { subscribe: true, listChanged: false }, tools: {}, prompts: {} },
    },
  );

  const resolveMed = (query: string): { med: Medication } | { error: string } => {
    const match = care.findMed(household(), query);
    if (match.med) return { med: match.med };
    if (match.candidates.length > 1) return { error: `"${query}" could mean ${match.candidates.map((m) => `${m.name} (${m.looks})`).join(' or ')}. Ask which one.` };
    const list = care.activeMeds(household()).map((m) => `${m.name} (${m.purpose}, ${m.looks})`).join('; ');
    return { error: `No current medication matches "${query}". Current medications: ${list}.` };
  };
  const fail = (message: string) => ({ content: text(message), isError: true });

  // ------------------------------------------------------------------ identity

  server.registerTool(
    'who_am_i',
    {
      title: 'Who is speaking',
      description: 'Returns who is using this device (name, role) and the household they belong to.',
      annotations: { readOnlyHint: true },
      outputSchema: z.object({ name: z.string(), role: z.enum(['recipient', 'caregiver']), household: z.string(), caresFor: z.string() }),
    },
    async () => {
      const out = { name: me().name, role: me().role, household: household().name, caresFor: memberLabel(recipient()) };
      return { content: text(`You are talking with ${out.name} (${out.role}) in the ${out.household}.`), structuredContent: out };
    },
  );

  // ------------------------------------------------------------------ today's schedule (MCP App)

  const scheduleEntry = z.object({
    medId: z.string(),
    medication: z.string(),
    strength: z.string(),
    looks: z.string(),
    purpose: z.string(),
    instructions: z.string().optional(),
    slot: z.string(),
    spokenTime: z.string(),
    state: z.enum(['taken', 'skipped', 'missed', 'due', 'upcoming']),
    loggedAt: z.string().optional(),
    loggedBy: z.string().optional(),
  });

  registerAppTool(
    server,
    'get_today',
    {
      title: "Today's medicines",
      description:
        "Today's medication schedule for the person being cared for, with each dose marked taken, skipped, missed, due now or upcoming. Use for 'what do I take now', 'did I take my pills', 'did Mom take her medicine'. Shows a card on screen devices.",
      annotations: { readOnlyHint: true },
      outputSchema: z.object({ person: z.string(), now: z.string(), entries: z.array(scheduleEntry) }),
      _meta: { ui: { resourceUri: UI.today } },
    },
    async () => {
      const entries = care.schedule(household());
      const due = entries.filter((e) => e.state === 'due');
      const missed = entries.filter((e) => e.state === 'missed');
      const nextUp = entries.find((e) => e.state === 'upcoming');
      const parts = [
        due.length ? `Due now: ${due.map((e) => `${e.medication} (${e.looks})`).join(', ')}.` : '',
        missed.length ? `Missed earlier: ${missed.map((e) => `${e.medication} at ${e.spokenTime}`).join(', ')}.` : '',
        `Taken today: ${entries.filter((e) => e.state === 'taken').map((e) => `${e.medication} at ${e.spokenTime}`).join(', ') || 'nothing yet'}.`,
        nextUp ? `Next: ${nextUp.medication} at ${nextUp.spokenTime}.` : 'Nothing else scheduled today.',
      ];
      const out = { person: recipient().name, now: care.now().toISOString(), entries };
      return { content: text(parts.filter(Boolean).join(' ')), structuredContent: out };
    },
  );

  server.registerTool(
    'log_dose',
    {
      title: 'Log a dose',
      description:
        'Record that a medication was taken (or deliberately skipped). The medication can be named loosely, by purpose or by appearance ("my blood pressure pill", "the pink one"). Refuses to log a second dose that was already taken, and says when it was taken — use this to prevent double-dosing.',
      inputSchema: z.object({
        medication: z.string().describe('Medication as the person referred to it'),
        status: z.enum(['taken', 'skipped']).default('taken'),
        slot: z.string().regex(/^\d{2}:\d{2}$/).optional().describe('Scheduled time HH:MM, only if the person named a specific dose'),
        note: z.string().optional(),
      }),
      outputSchema: z.object({
        logged: z.boolean(),
        medication: z.string().optional(),
        slot: z.string().optional(),
        status: z.string().optional(),
        pillsLeft: z.number().optional(),
        alreadyTakenAt: z.string().optional(),
      }),
    },
    async ({ medication, status, slot, note }) => {
      const r = resolveMed(medication);
      if ('error' in r) return fail(r.error);
      const res = care.logDose(household(), me(), r.med, status, slot, note);
      if (!res.ok && res.reason === 'already_logged') {
        const at = new Date(res.event.at);
        const when = speakTime(`${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`);
        const who = household().members.find((m) => m.id === res.event.by)?.name ?? 'someone';
        return {
          content: text(`Not logged: the ${speakTime(res.event.slot)} ${r.med.name} was already taken at ${when} (logged by ${who}). Do not take another.`),
          structuredContent: { logged: false, medication: r.med.name, slot: res.event.slot, alreadyTakenAt: res.event.at },
        };
      }
      if (!res.ok) return fail(`There is no dose of ${r.med.name} left to log today.`);
      const low = res.pillsLeft <= r.med.pillsPerDose * r.med.times.length * 7;
      return {
        content: text(
          `Logged ${r.med.name} ${status} for the ${speakTime(res.event.slot)} dose.` + (low && status === 'taken' ? ` Only ${res.pillsLeft} left — consider a refill.` : ''),
        ),
        structuredContent: { logged: true, medication: r.med.name, slot: res.event.slot, status, pillsLeft: res.pillsLeft },
      };
    },
  );

  // ------------------------------------------------------------------ medication management

  server.registerTool(
    'add_medication',
    {
      title: 'Add a medication',
      description:
        'Add a new prescription to the schedule. The spoken name is normalised against the NIH RxNorm database (speech recognition often mangles drug names), so pass it as heard. If confidence is not high, the result asks you to confirm the name with the person first; call again with confirmed_name.',
      inputSchema: z.object({
        name: z.string().describe('Medication name as heard'),
        confirmed_name: z.string().optional().describe('RxNorm ingredient name the person confirmed'),
        strength: z.string().describe('e.g. "5 mg"'),
        times: z.array(z.string().regex(/^\d{2}:\d{2}$/)).min(1).describe('Daily times, 24h HH:MM'),
        purpose: z.string().describe('What it is for, in the person\'s words'),
        looks: z.string().default('').describe('What the pill looks like'),
        pills_on_hand: z.number().int().min(0).default(30),
        pills_per_dose: z.number().int().min(1).default(1),
        instructions: z.string().optional(),
      }),
      outputSchema: z.object({ added: z.boolean(), name: z.string().optional(), rxcui: z.string().optional(), candidates: z.array(z.string()).optional() }),
    },
    async (args) => {
      let name = args.confirmed_name;
      let rxcui: string | undefined;
      if (!name) {
        const matches = await rx.normalise(args.name).catch(() => []);
        if (matches.length === 0) return fail(`RxNorm has no medication matching "${args.name}". Ask the person to spell it or read it from the bottle.`);
        if (matches[0].confidence !== 'high') {
          return {
            content: text(`Heard "${args.name}". Closest RxNorm matches: ${matches.map((m) => m.ingredient).join(', ')}. Confirm with the person, then call again with confirmed_name.`),
            structuredContent: { added: false, candidates: matches.map((m) => m.ingredient) },
          };
        }
        name = matches[0].ingredient;
        rxcui = matches[0].rxcui;
      }
      const display = name.replace(/\b\w/g, (c) => c.toUpperCase());
      const med = care.addMedication(household(), {
        name: display,
        rxcui,
        strength: args.strength,
        form: 'tablet',
        purpose: args.purpose,
        looks: args.looks || 'tablet',
        instructions: args.instructions,
        times: args.times,
        pillsPerDose: args.pills_per_dose,
        pillsOnHand: args.pills_on_hand,
        refillsRemaining: 3,
        refillPrice: 10,
        refillQuantity: 30,
      });
      care.notifyCaregivers(household(), {
        kind: 'message',
        severity: 'info',
        title: `${med.name} added to ${recipient().name}'s medicines`,
        detail: `${me().name} added ${med.name} ${med.strength} at ${med.times.map(speakTime).join(' and ')}.`,
        from: me().id,
      });
      return {
        content: text(`Added ${med.name} ${med.strength} at ${med.times.map(speakTime).join(' and ')}${rxcui ? ` (RxNorm ${rxcui})` : ''}.`),
        structuredContent: { added: true, name: med.name, rxcui },
      };
    },
  );

  server.registerTool(
    'medication_info',
    {
      title: 'Medication facts (FDA label)',
      description:
        'Answers "what is this pill for", "what are the side effects", "can I take it with X" by quoting the official FDA drug label via openFDA. Returns a quote plus its source. Relay it briefly and attribute it; never turn it into dosing advice.',
      annotations: { readOnlyHint: true, openWorldHint: true },
      inputSchema: z.object({
        medication: z.string(),
        topic: z.enum(['purpose', 'side_effects', 'warnings', 'interactions', 'patient_info']).default('purpose'),
      }),
      outputSchema: z.object({
        medication: z.string(),
        topic: z.string(),
        prescribedFor: z.string().optional(),
        excerpt: z.string(),
        source: z.object({ title: z.string(), url: z.string(), labelDate: z.string() }),
      }),
    },
    async ({ medication, topic }) => {
      const r = resolveMed(medication);
      // Not on the list? Still answer from the label, using RxNorm to find the ingredient.
      let ingredient = 'med' in r ? r.med.name.toLowerCase() : undefined;
      if (!ingredient) ingredient = (await rx.normalise(medication).catch(() => []))[0]?.ingredient;
      if (!ingredient) return fail(`I could not identify "${medication}".`);
      const ex = await fda.excerpt(ingredient, topic).catch(() => null);
      if (!ex) return fail(`The FDA label for ${ingredient} has no ${topic.replace('_', ' ')} section I can read right now.`);
      const out = { ...ex, prescribedFor: 'med' in r ? r.med.purpose : undefined };
      return {
        content: text(`${out.prescribedFor ? `Prescribed for ${out.prescribedFor}. ` : ''}FDA label (${ex.source.labelDate}), ${topic.replace('_', ' ')}: ${ex.excerpt}`),
        structuredContent: out,
      };
    },
  );

  // ------------------------------------------------------------------ refills (purchasing, MCP App + elicitation)

  const orderSchema = z.object({
    orderId: z.string(),
    medication: z.string(),
    strength: z.string(),
    quantity: z.number(),
    price: z.number(),
    pharmacy: z.string(),
    status: z.enum(['pending', 'placed', 'declined']),
    eta: z.string().optional(),
    delivery: z.string(),
  });
  const describeOrder = (o: Order) => {
    const med = household().meds.find((m) => m.id === o.medId)!;
    return {
      orderId: o.id,
      medication: med.name,
      strength: med.strength,
      quantity: o.quantity,
      price: o.price,
      pharmacy: o.pharmacy,
      status: o.status,
      eta: o.eta,
      delivery: household().pharmacy.deliveryNote,
    };
  };

  server.registerTool(
    'refill_status',
    {
      title: 'Refill status',
      description: 'How many days of each medication are left, which need a refill soon, refills remaining on each prescription, and anything already on the way.',
      annotations: { readOnlyHint: true },
      outputSchema: z.object({
        medications: z.array(
          z.object({
            medId: z.string(),
            medication: z.string(),
            pillsOnHand: z.number(),
            daysLeft: z.number(),
            runsOutOn: z.string(),
            refillsRemaining: z.number(),
            needsRefill: z.boolean(),
            refillOnTheWay: z.object({ orderId: z.string(), eta: z.string() }).optional(),
          }),
        ),
      }),
    },
    async () => {
      const meds = care.refillStatus(household());
      const low = meds.filter((m) => m.needsRefill);
      const line = low.length
        ? `Running low: ${low.map((m) => `${m.medication}, about ${m.daysLeft} days left`).join('; ')}.`
        : 'Nothing is running low.';
      const coming = meds.filter((m) => m.refillOnTheWay);
      return {
        content: text(line + (coming.length ? ` On the way: ${coming.map((m) => `${m.medication} (arrives ${m.refillOnTheWay!.eta})`).join(', ')}.` : '')),
        structuredContent: { medications: meds },
      };
    },
  );

  registerAppTool(
    server,
    'order_refill',
    {
      title: 'Order a refill',
      description:
        'Order a refill of a medication from the household pharmacy (simulated). The person is always asked to confirm the price and delivery before the order is placed — via an on-device confirmation when the client supports MCP elicitation, otherwise by returning a pending order to confirm with confirm_refill.',
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
      inputSchema: z.object({ medication: z.string() }),
      outputSchema: orderSchema,
      _meta: { ui: { resourceUri: UI.refill } },
    },
    async ({ medication }, ctx) => {
      const r = resolveMed(medication);
      if ('error' in r) return fail(r.error);
      const quote = care.quoteRefill(household(), me(), r.med);
      if ('error' in quote) return fail(quote.error);
      const summary = `${quote.quantity} ${r.med.name} ${r.med.strength} from ${quote.pharmacy} for $${quote.price.toFixed(2)}, ${household().pharmacy.deliveryNote}`;

      const canElicit = Boolean(server.server.getClientCapabilities()?.elicitation);
      if (canElicit) {
        const answer = await ctx.mcpReq.elicitInput({
          mode: 'form',
          message: `Order ${summary}?`,
          requestedSchema: {
            type: 'object',
            properties: { confirm: { type: 'boolean', title: 'Place this order', description: summary } },
            required: ['confirm'],
          },
        });
        if (answer.action === 'accept' && answer.content?.confirm === true) {
          const placed = care.placeOrder(household(), quote, me());
          return { content: text(`Ordered: ${summary}. Order ${placed.id}.`), structuredContent: describeOrder(placed) };
        }
        const declined = care.declineOrder(household(), quote);
        return { content: text('Okay, I did not place the order.'), structuredContent: describeOrder(declined) };
      }
      return {
        content: text(`Quote ready, NOT yet ordered: ${summary}. Read this back and ask the person to confirm, then call confirm_refill with order_id ${quote.id}.`),
        structuredContent: describeOrder(quote),
      };
    },
  );

  server.registerTool(
    'confirm_refill',
    {
      title: 'Confirm or cancel a pending refill',
      description: 'Place (confirm=true) or cancel (confirm=false) a pending refill order. Only call after the person has explicitly said yes to the price and delivery.',
      inputSchema: z.object({ order_id: z.string(), confirm: z.boolean() }),
      outputSchema: orderSchema,
    },
    async ({ order_id, confirm }) => {
      const order = household().orders.find((o) => o.id === order_id);
      if (!order || order.status !== 'pending') return fail(`There is no pending order ${order_id}.`);
      const done = confirm ? care.placeOrder(household(), order, me()) : care.declineOrder(household(), order);
      const d = describeOrder(done);
      return {
        content: text(confirm ? `Ordered ${d.quantity} ${d.medication}, ${d.delivery}.` : 'Cancelled — nothing was ordered.'),
        structuredContent: d,
      };
    },
  );

  // ------------------------------------------------------------------ wellbeing & family

  server.registerTool(
    'log_checkin',
    {
      title: 'Daily check-in',
      description:
        'Record how the person is feeling today, with their own words as the note. Mentions of a fall, chest pain, dizziness, breathing trouble, confusion or bleeding — or a "bad" mood — automatically alert the family.',
      inputSchema: z.object({
        mood: z.enum(['great', 'good', 'okay', 'not_great', 'bad']),
        note: z.string().optional().describe("The person's own words"),
      }),
      outputSchema: z.object({ recorded: z.boolean(), familyAlerted: z.boolean(), flags: z.array(z.string()) }),
    },
    async ({ mood, note }) => {
      const { checkin, alerted } = care.checkin(household(), me(), mood, note);
      const caregivers = household().members.filter((m) => m.role === 'caregiver').map((m) => m.name).join(' and ');
      return {
        content: text(
          alerted
            ? `Check-in saved and ${caregivers} ${checkin.flags.length ? 'has been alerted' : 'will see it'}.${checkin.flags.length ? ' If this is an emergency, call 911.' : ''}`
            : 'Check-in saved.',
        ),
        structuredContent: { recorded: true, familyAlerted: alerted, flags: checkin.flags },
      };
    },
  );

  registerAppTool(
    server,
    'care_summary',
    {
      title: 'How is everyone doing',
      description:
        "A caregiver's overview of the past days: medication adherence, missed doses, mood trend from check-ins, refills running low and open alerts. Use for 'how's Mom doing', 'how was her week'. Shows a summary card with charts.",
      annotations: { readOnlyHint: true },
      inputSchema: z.object({ days: z.number().int().min(1).max(30).default(7) }),
      _meta: { ui: { resourceUri: UI.summary } },
    },
    async ({ days }) => {
      const s = care.summary(household(), days);
      const latest = s.mood.at(-1);
      const missed = s.adherence.missedDoses;
      const line = [
        `${s.person} took ${s.adherence.percent}% of scheduled medicines over the last ${days} days (${s.adherence.taken} of ${s.adherence.expected}).`,
        missed.length ? `Missed: ${missed.map((m) => `${m.medication} ${speakTime(m.slot)} on ${m.day}`).join('; ')}.` : 'No missed doses.',
        latest ? `Latest check-in: ${latest.mood.replace('_', ' ')}${latest.note ? ` — "${latest.note}"` : ''}.` : '',
        s.refills.some((r) => r.needsRefill) ? `Low: ${s.refills.filter((r) => r.needsRefill).map((r) => `${r.medication} (${r.daysLeft} days)`).join(', ')}.` : '',
        s.openAlerts.length ? `${s.openAlerts.length} open alert(s).` : '',
      ];
      return { content: text(line.filter(Boolean).join(' ')), structuredContent: s as unknown as Record<string, unknown> };
    },
  );

  server.registerTool(
    'send_family_message',
    {
      title: 'Send a message to family',
      description:
        "Send a short message to the other people in the household (from June to her family, or from a caregiver to June's device, where it is read aloud). Use for 'tell Maya…', 'let Mom know I'll call at 6'.",
      inputSchema: z.object({ message: z.string().min(1), urgent: z.boolean().default(false) }),
      outputSchema: z.object({ deliveredTo: z.array(z.string()) }),
    },
    async ({ message, urgent }) => {
      const to = household().members.filter((m) => m.id !== me().id);
      for (const m of to) {
        care.push(household(), {
          to: m.id,
          from: me().id,
          kind: 'message',
          severity: urgent ? 'urgent' : 'info',
          title: `Message from ${me().name}`,
          detail: message,
        });
      }
      return { content: text(`Sent to ${to.map((m) => m.name).join(' and ')}.`), structuredContent: { deliveredTo: to.map((m) => m.name) } };
    },
  );

  server.registerTool(
    'check_inbox',
    {
      title: 'Check notifications',
      description: 'Unread reminders, alerts, messages and order updates for the person using this device. Pass mark_read=true after reading them out.',
      inputSchema: z.object({ mark_read: z.boolean().default(false) }),
      outputSchema: z.object({
        items: z.array(z.object({ id: z.string(), kind: z.string(), severity: z.string(), title: z.string(), detail: z.string(), at: z.string(), from: z.string().optional() })),
      }),
    },
    async ({ mark_read }) => {
      const items = care.unread(household(), me().id).map((i) => ({
        id: i.id,
        kind: i.kind,
        severity: i.severity,
        title: i.title,
        detail: i.detail,
        at: i.at,
        from: household().members.find((m) => m.id === i.from)?.name,
      }));
      if (mark_read) care.markRead(household(), me().id, items.map((i) => i.id));
      return {
        content: text(items.length ? items.map((i) => `${i.title}: ${i.detail}`).join('\n') : 'No new notifications.'),
        structuredContent: { items },
      };
    },
  );

  // ------------------------------------------------------------------ resources

  server.registerResource(
    'household-profile',
    PROFILE_URI,
    { title: 'Household profile', description: 'Members and current medications', mimeType: 'application/json' },
    async (uri) => {
      const h = household();
      const profile = {
        household: h.name,
        members: h.members.map(({ id: _id, ...m }) => m),
        medications: care.activeMeds(h).map(({ id: _id, refillPrice: _p, ...m }) => m),
        pharmacy: h.pharmacy.name,
      };
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(profile, null, 2) }] };
    },
  );

  server.registerResource(
    'inbox',
    INBOX_URI,
    {
      title: 'Notifications for this device',
      description: 'Unread reminders, alerts and messages for the current person. Subscribe to get notifications/resources/updated when something new arrives (proactive reminders).',
      mimeType: 'application/json',
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(care.unread(household(), me().id), null, 2) }],
    }),
  );

  for (const [key, uri] of Object.entries(UI)) {
    registerAppResource(server, `${key} view`, uri, { description: `Hearth ${key} card` }, async () => ({
      contents: [{ uri, mimeType: RESOURCE_MIME_TYPE, text: loadView(deps.uiDir, `${key}.html`) }],
    }));
  }

  server.server.setRequestHandler('resources/subscribe', async (req) => {
    subscriptions.add(req.params.uri);
    return {};
  });
  server.server.setRequestHandler('resources/unsubscribe', async (req) => {
    subscriptions.delete(req.params.uri);
    return {};
  });

  // ------------------------------------------------------------------ prompts

  server.registerPrompt(
    'morning_checkin',
    { title: 'Morning check-in', description: 'A gentle morning routine: how are you feeling, then what to take now.' },
    async () => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `Good morning routine for ${recipient().name}: greet them warmly, ask how they slept and how they feel, record it with log_checkin in their own words, then use get_today to say what to take now and what each pill looks like.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'caregiver_briefing',
    {
      title: 'Caregiver briefing',
      description: 'Everything a family member needs to know right now, in under 30 seconds of speech.',
      argsSchema: z.object({ days: z.string().optional().describe('How many days to cover (default 7)') }),
    },
    async ({ days }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `Brief ${me().name} on how ${recipient().name} is doing: call check_inbox, then care_summary for ${days ?? '7'} days. Lead with anything urgent, then adherence, mood, and refills that need action. Offer to order any low refill.`,
          },
        },
      ],
    }),
  );

  /** Push a resources/updated notification if this session subscribed to the inbox. */
  const notifyInbox = async () => {
    if (subscriptions.has(INBOX_URI)) await server.server.sendResourceUpdated({ uri: INBOX_URI }).catch(() => undefined);
  };

  return { server, notifyInbox, memberId: id.memberId, householdId: id.householdId };
}
