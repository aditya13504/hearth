import { EventEmitter } from 'node:events';
import { addDays, atSlot, Clock, dateKey, speakTime } from './clock.js';
import {
  type Checkin,
  type DoseEvent,
  type DoseStatus,
  type Household,
  type InboxItem,
  type Medication,
  type Member,
  type Mood,
  newId,
  type Order,
  Store,
} from './store.js';

/** Reminders open 30 minutes before a dose; a dose becomes "missed" 60 minutes after its time. */
export const DUE_WINDOW_BEFORE_MIN = 30;
export const MISSED_AFTER_MIN = 60;
export const LOW_SUPPLY_DAYS = 7;

export type SlotState = 'taken' | 'skipped' | 'missed' | 'due' | 'upcoming';

export interface ScheduleEntry {
  medId: string;
  medication: string;
  strength: string;
  looks: string;
  purpose: string;
  instructions?: string;
  slot: string;
  spokenTime: string;
  state: SlotState;
  loggedAt?: string;
  loggedBy?: string;
}

export interface MedMatch {
  med?: Medication;
  candidates: Medication[];
}

/** Words that should always reach the family, whatever mood was reported. */
const RED_FLAGS: Array<[RegExp, string]> = [
  [/\bfell\b|\bfall(en|ing)?\b|\btripped\b/i, 'fall'],
  [/chest (pain|tight)/i, 'chest pain'],
  [/dizz|light.?headed|faint/i, 'dizziness'],
  [/short of breath|can'?t breathe|trouble breathing/i, 'breathing'],
  [/confus|forgetful|lost track/i, 'confusion'],
  [/bleed/i, 'bleeding'],
];

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Levenshtein distance, used because speech recognition routinely mangles drug names. */
export function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

export class CareService {
  readonly events = new EventEmitter();

  constructor(
    readonly store: Store,
    readonly clock: Clock,
  ) {}

  now(): Date {
    return this.clock.now();
  }

  // ---------------------------------------------------------------- medications

  activeMeds(h: Household): Medication[] {
    return h.meds.filter((m) => m.active);
  }

  /**
   * Resolve how a person referred to a medication: by name ("metformin", "met for men"),
   * by purpose ("my blood pressure pill") or by appearance ("the pink one").
   */
  findMed(h: Household, query: string): MedMatch {
    const q = normalise(query);
    const meds = this.activeMeds(h);
    if (!q) return { candidates: meds };

    const byName = meds.filter((m) => q.includes(normalise(m.name)) || normalise(m.name).includes(q));
    if (byName.length === 1) return { med: byName[0], candidates: byName };

    const scored = meds
      .map((m) => {
        const name = normalise(m.name);
        const words = q.split(' ');
        const fuzzy = Math.min(...words.map((w) => editDistance(w, name)), editDistance(q.replace(/ /g, ''), name));
        const purpose = normalise(m.purpose);
        const purposeWordHits = purpose
          .split(' ')
          .filter((w) => w.length > 3)
          .filter((w) => q.includes(w)).length;
        const purposeHit = q.includes(purpose) ? 2 : purposeWordHits > 0 ? 1 : 0;
        const looksHit = normalise(m.looks)
          .split(' ')
          .filter((w) => w.length > 3 && !['tablet', 'with'].includes(w))
          .some((w) => q.includes(w));
        let score = fuzzy <= Math.max(2, Math.floor(name.length / 3)) ? 10 - fuzzy : 0;
        score += purposeHit * 4;
        if (looksHit) score += 4;
        return { m, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);

    if (scored.length === 0) return { candidates: [] };
    if (scored.length === 1 || scored[0].score > scored[1].score) return { med: scored[0].m, candidates: [scored[0].m] };
    return { candidates: scored.filter((x) => x.score === scored[0].score).map((x) => x.m) };
  }

  addMedication(h: Household, med: Omit<Medication, 'id' | 'active' | 'startsAt'>): Medication {
    const created: Medication = { ...med, id: newId('med'), active: true, startsAt: this.now().toISOString() };
    h.meds.push(created);
    this.store.save();
    return created;
  }

  // ---------------------------------------------------------------- schedule & doses

  /** Is this dose part of the regimen? Slots from before the medication was added are not. */
  inEffect(med: Medication, day: string, slot: string): boolean {
    return !med.startsAt || atSlot(day, slot).getTime() >= new Date(med.startsAt).getTime();
  }

  slotState(h: Household, med: Medication, day: string, slot: string, now = this.now()): { state: SlotState; event?: DoseEvent } {
    const event = h.doses.find((d) => d.medId === med.id && d.day === day && d.slot === slot);
    if (event) return { state: event.status, event };
    const at = atSlot(day, slot).getTime();
    const t = now.getTime();
    if (t > at + MISSED_AFTER_MIN * 60_000) return { state: 'missed' };
    if (t >= at - DUE_WINDOW_BEFORE_MIN * 60_000) return { state: 'due' };
    return { state: 'upcoming' };
  }

  schedule(h: Household, day = dateKey(this.now())): ScheduleEntry[] {
    const now = this.now();
    const entries: ScheduleEntry[] = [];
    for (const med of this.activeMeds(h)) {
      for (const slot of med.times) {
        if (!this.inEffect(med, day, slot)) continue;
        const { state, event } = this.slotState(h, med, day, slot, now);
        entries.push({
          medId: med.id,
          medication: med.name,
          strength: med.strength,
          looks: med.looks,
          purpose: med.purpose,
          instructions: med.instructions,
          slot,
          spokenTime: speakTime(slot),
          state,
          loggedAt: event?.at,
          loggedBy: event ? h.members.find((m) => m.id === event.by)?.name : undefined,
        });
      }
    }
    return entries.sort((a, b) => a.slot.localeCompare(b.slot) || a.medication.localeCompare(b.medication));
  }

  /**
   * Record a dose. Without an explicit slot, picks the most relevant unlogged slot today
   * (due first, then missed, then the next upcoming one). Refuses to record a second "taken"
   * for a slot that is already taken — double-dosing is the failure we most want to prevent.
   */
  logDose(
    h: Household,
    by: Member,
    med: Medication,
    status: DoseStatus,
    slot?: string,
    note?: string,
  ): { ok: true; event: DoseEvent; pillsLeft: number } | { ok: false; reason: 'already_logged'; event: DoseEvent } | { ok: false; reason: 'no_slot' } {
    const now = this.now();
    const day = dateKey(now);
    let chosen = slot;
    if (!chosen) {
      const states = med.times.filter((s) => this.inEffect(med, day, s)).map((s) => ({ s, ...this.slotState(h, med, day, s, now) }));
      const open = states.filter((x) => !x.event);
      const pick =
        open.find((x) => x.state === 'due') ??
        open.filter((x) => x.state === 'missed').pop() ??
        open.find((x) => x.state === 'upcoming');
      if (!pick) {
        const last = states.filter((x) => x.event).pop();
        if (last?.event) return { ok: false, reason: 'already_logged', event: last.event };
        return { ok: false, reason: 'no_slot' };
      }
      chosen = pick.s;
    }
    const existing = h.doses.find((d) => d.medId === med.id && d.day === day && d.slot === chosen);
    if (existing && existing.status === 'taken') return { ok: false, reason: 'already_logged', event: existing };
    if (existing) h.doses.splice(h.doses.indexOf(existing), 1);

    const event: DoseEvent = { id: newId('dose'), medId: med.id, day, slot: chosen, status, at: now.toISOString(), by: by.id, note };
    h.doses.push(event);
    if (status === 'taken') med.pillsOnHand = Math.max(0, med.pillsOnHand - med.pillsPerDose);
    // A dose logged late resolves the open "missed" alert for that slot.
    for (const item of h.inbox) {
      if (!item.readAt && item.key === `missed|${day}|${chosen}`) {
        const stillOpen = this.activeMeds(h).some(
          (m) => m.times.includes(chosen!) && this.inEffect(m, day, chosen!) && this.slotState(h, m, day, chosen!, now).state === 'missed',
        );
        if (!stillOpen) item.readAt = now.toISOString();
      }
    }
    this.store.save();
    this.events.emit('changed', h.id);
    return { ok: true, event, pillsLeft: med.pillsOnHand };
  }

  // ---------------------------------------------------------------- adherence & summary

  adherence(h: Household, days: number) {
    const now = this.now();
    const today = dateKey(now);
    const perDay: Array<{ day: string; expected: number; taken: number }> = [];
    const missedDoses: Array<{ day: string; slot: string; medication: string }> = [];
    const perMed = new Map<string, { medication: string; expected: number; taken: number }>();
    for (let offset = -(days - 1); offset <= 0; offset++) {
      const day = addDays(today, offset);
      let expected = 0;
      let taken = 0;
      for (const med of this.activeMeds(h)) {
        const stats = perMed.get(med.id) ?? { medication: med.name, expected: 0, taken: 0 };
        for (const slot of med.times) {
          if (!this.inEffect(med, day, slot)) continue;
          const { state } = this.slotState(h, med, day, slot, now);
          if (state === 'upcoming' || state === 'due') continue; // not judged yet
          expected++;
          stats.expected++;
          if (state === 'taken') {
            taken++;
            stats.taken++;
          } else missedDoses.push({ day, slot, medication: med.name });
        }
        perMed.set(med.id, stats);
      }
      perDay.push({ day, expected, taken });
    }
    const expected = perDay.reduce((a, d) => a + d.expected, 0);
    const taken = perDay.reduce((a, d) => a + d.taken, 0);
    return {
      percent: expected === 0 ? 100 : Math.round((taken / expected) * 100),
      expected,
      taken,
      perDay,
      perMed: [...perMed.values()],
      missedDoses,
    };
  }

  refillStatus(h: Household) {
    const today = dateKey(this.now());
    return this.activeMeds(h).map((med) => {
      const perDay = med.pillsPerDose * med.times.length;
      const daysLeft = Math.floor(med.pillsOnHand / perDay);
      const openOrder = h.orders.find((o) => o.medId === med.id && o.status === 'placed' && o.eta && o.eta >= today);
      return {
        medId: med.id,
        medication: med.name,
        pillsOnHand: med.pillsOnHand,
        daysLeft,
        runsOutOn: addDays(today, daysLeft),
        refillsRemaining: med.refillsRemaining,
        needsRefill: daysLeft < LOW_SUPPLY_DAYS && !openOrder,
        refillOnTheWay: openOrder ? { orderId: openOrder.id, eta: openOrder.eta! } : undefined,
      };
    });
  }

  summary(h: Household, days = 7) {
    const now = this.now();
    const since = addDays(dateKey(now), -(days - 1));
    const recipient = h.members.find((m) => m.role === 'recipient')!;
    const checkins = h.checkins
      .filter((c) => c.memberId === recipient.id && dateKey(new Date(c.at)) >= since)
      .sort((a, b) => a.at.localeCompare(b.at));
    const moodScore: Record<Mood, number> = { bad: 1, not_great: 2, okay: 3, good: 4, great: 5 };
    return {
      person: recipient.name,
      days,
      generatedAt: now.toISOString(),
      adherence: this.adherence(h, days),
      today: this.schedule(h),
      mood: checkins.map((c) => ({ day: dateKey(new Date(c.at)), mood: c.mood, score: moodScore[c.mood], note: c.note, flags: c.flags })),
      refills: this.refillStatus(h),
      openAlerts: h.inbox.filter((i) => !i.readAt && i.kind === 'alert'),
    };
  }

  // ---------------------------------------------------------------- wellbeing

  /**
   * Record how the person being cared for is doing. A check-in is always about them: when a caregiver
   * reports it ("Mom told me she fell"), it is recorded against the recipient and marked as reported.
   * Red flags alert every other caregiver, at most once per flag every two hours.
   */
  checkin(h: Household, reporter: Member, mood: Mood, note?: string): { checkin: Checkin; alerted: boolean } {
    const now = this.now();
    const subject = h.members.find((m) => m.role === 'recipient') ?? reporter;
    const flags = RED_FLAGS.filter(([re]) => re.test(note ?? '')).map(([, label]) => label);
    const checkin: Checkin = {
      id: newId('chk'),
      at: now.toISOString(),
      memberId: subject.id,
      mood,
      note,
      flags,
      reportedBy: reporter.id !== subject.id ? reporter.id : undefined,
    };
    h.checkins.push(checkin);
    let alerted = false;
    if (flags.length > 0 || mood === 'bad') {
      const said = reporter.id === subject.id ? `${subject.name} said` : `${reporter.name} reported`;
      const window = `${dateKey(now)}|${Math.floor(now.getHours() / 2)}`;
      const sent = h.members
        .filter((m) => m.role === 'caregiver' && m.id !== reporter.id)
        .map((m) =>
          this.push(h, {
            to: m.id,
            kind: 'alert',
            severity: flags.length > 0 ? 'urgent' : 'warning',
            title: flags.length > 0 ? `${subject.name} mentioned ${flags.join(' and ')}` : `${subject.name} is having a bad day`,
            detail: note ? `${said}: "${note}"` : `${said} feeling ${mood.replace('_', ' ')}.`,
            from: reporter.id,
            key: `wellbeing|${window}|${flags.length ? [...flags].sort().join('+') : 'bad-day'}`,
          }),
        )
        .filter(Boolean);
      alerted = sent.length > 0;
    }
    this.store.save();
    this.events.emit('changed', h.id);
    return { checkin, alerted };
  }

  // ---------------------------------------------------------------- inbox

  push(h: Household, item: Omit<InboxItem, 'id' | 'at'>): InboxItem | null {
    if (item.key && h.inbox.some((i) => i.key === item.key && i.to === item.to)) return null;
    const created: InboxItem = { ...item, id: newId('inb'), at: this.now().toISOString() };
    h.inbox.push(created);
    this.store.save();
    this.events.emit('inbox', h.id, created);
    return created;
  }

  notifyCaregivers(h: Household, item: Omit<InboxItem, 'id' | 'at' | 'to'>): InboxItem[] {
    return h.members
      .filter((m) => m.role === 'caregiver')
      .map((m) => this.push(h, { ...item, to: m.id }))
      .filter((x): x is InboxItem => x !== null);
  }

  unread(h: Household, memberId: string): InboxItem[] {
    return h.inbox.filter((i) => i.to === memberId && !i.readAt).sort((a, b) => a.at.localeCompare(b.at));
  }

  markRead(h: Household, memberId: string, ids?: string[]): number {
    const now = this.now().toISOString();
    let n = 0;
    for (const item of h.inbox) {
      if (item.to === memberId && !item.readAt && (!ids || ids.includes(item.id))) {
        item.readAt = now;
        n++;
      }
    }
    this.store.save();
    return n;
  }

  // ---------------------------------------------------------------- refills (simulated pharmacy)

  quoteRefill(h: Household, by: Member, med: Medication): Order | { error: string } {
    if (med.refillsRemaining <= 0) return { error: `There are no refills left on the ${med.name} prescription. The prescriber needs to approve a new one.` };
    const existing = h.orders.find((o) => o.medId === med.id && (o.status === 'pending' || (o.status === 'placed' && (o.eta ?? '') >= dateKey(this.now()))));
    if (existing?.status === 'placed') return { error: `A ${med.name} refill is already on the way (order ${existing.id}, arriving ${existing.eta}).` };
    if (existing) return existing;
    const order: Order = {
      id: newId('ord'),
      medId: med.id,
      quantity: med.refillQuantity,
      price: med.refillPrice,
      pharmacy: h.pharmacy.name,
      status: 'pending',
      createdAt: this.now().toISOString(),
      requestedBy: by.id,
    };
    h.orders.push(order);
    this.store.save();
    return order;
  }

  placeOrder(h: Household, order: Order, by: Member): Order {
    const med = h.meds.find((m) => m.id === order.medId)!;
    order.status = 'placed';
    order.placedAt = this.now().toISOString();
    order.eta = addDays(dateKey(this.now()), 1);
    med.refillsRemaining -= 1;
    // Resolve low-supply alerts for this medication.
    for (const item of h.inbox) if (!item.readAt && item.key?.startsWith(`low|${med.id}|`)) item.readAt = this.now().toISOString();
    const other = h.members.filter((m) => m.id !== by.id);
    for (const m of other) {
      this.push(h, {
        to: m.id,
        from: by.id,
        kind: 'order',
        severity: 'info',
        title: `${med.name} refill ordered`,
        detail: `${by.name} ordered ${order.quantity} ${med.name} ${med.strength} from ${order.pharmacy}, ${h.pharmacy.deliveryNote}. $${order.price.toFixed(2)}.`,
      });
    }
    this.store.save();
    this.events.emit('changed', h.id);
    return order;
  }

  declineOrder(h: Household, order: Order): Order {
    order.status = 'declined';
    this.store.save();
    return order;
  }

  // ---------------------------------------------------------------- scheduler

  /**
   * Runs every few seconds (and immediately when the demo clock jumps). Raises, at most once each:
   * - a reminder to the care recipient when a dose time arrives,
   * - an alert to caregivers when a dose is an hour late,
   * - a low-supply alert to caregivers when a medication has under a week left and nothing is on order.
   */
  tick(): void {
    const now = this.now();
    const day = dateKey(now);
    for (const h of this.store.db.households) {
      const recipient = h.members.find((m) => m.role === 'recipient');
      if (!recipient) continue;
      const slots = [...new Set(this.activeMeds(h).flatMap((m) => m.times))].sort();
      for (const slot of slots) {
        const meds = this.activeMeds(h).filter((m) => m.times.includes(slot) && this.inEffect(m, day, slot));
        const states = meds.map((m) => ({ m, state: this.slotState(h, m, day, slot, now).state }));
        const at = atSlot(day, slot).getTime();
        const open = states.filter((s) => s.state === 'due' || s.state === 'missed');
        if (open.length === 0) continue;
        const names = open.map((s) => `${s.m.name} (${s.m.looks})`).join(' and ');

        if (now.getTime() >= at && now.getTime() <= at + MISSED_AFTER_MIN * 60_000) {
          this.push(h, {
            to: recipient.id,
            kind: 'reminder',
            severity: 'info',
            title: `Time for your ${speakTime(slot)} medicine`,
            detail: `It's time to take ${names}.`,
            key: `reminder|${day}|${slot}`,
          });
        }
        const missed = states.filter((s) => s.state === 'missed');
        if (missed.length > 0) {
          this.notifyCaregivers(h, {
            kind: 'alert',
            severity: 'warning',
            title: `${recipient.name} hasn't taken the ${speakTime(slot)} medicine`,
            detail: `${missed.map((s) => s.m.name).join(' and ')} — due at ${speakTime(slot)}, not logged after ${MISSED_AFTER_MIN} minutes.`,
            from: recipient.id,
            key: `missed|${day}|${slot}`,
          });
        }
      }
      for (const r of this.refillStatus(h)) {
        if (!r.needsRefill) continue;
        this.notifyCaregivers(h, {
          kind: 'alert',
          severity: 'info',
          title: `${recipient.name}'s ${r.medication} is running low`,
          detail: `${r.pillsOnHand} left — about ${r.daysLeft} days. ${r.refillsRemaining} refills remaining on the prescription.`,
          key: `low|${r.medId}|${day}`,
        });
      }
    }
  }

  // Exposed for the demo controls: make history line up with "now" after a clock jump.
  reseed(): void {
    this.store.reset(this.now());
    this.events.emit('changed', 'all');
  }
}

export function memberLabel(member: Member): string {
  return member.relationship ? `${member.name} (${member.relationship})` : member.name;
}
