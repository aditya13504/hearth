import { beforeEach, describe, expect, it } from 'vitest';
import { CareService } from '../src/care.js';
import { Clock, dateKey } from '../src/clock.js';
import { Store } from '../src/store.js';

function setup(hhmm = '07:00') {
  const clock = new Clock();
  clock.setTimeOfDay(hhmm);
  const store = new Store(null, clock.now());
  const care = new CareService(store, clock);
  const h = store.household('hh_alvarez');
  const june = h.members.find((m) => m.id === 'mem_june')!;
  const maya = h.members.find((m) => m.id === 'mem_maya')!;
  return { clock, store, care, h, june, maya };
}

describe('findMed', () => {
  const { care, h } = setup();
  it.each([
    ['metformin', 'Metformin'],
    ['met for men', 'Metformin'],
    ['lisinoprl', 'Lisinopril'],
    ['my blood pressure pill', 'Lisinopril'],
    ['the pink one', 'Lisinopril'],
    ['cholesterol medicine', 'Atorvastatin'],
  ])('resolves "%s" to %s', (query, expected) => {
    expect(care.findMed(h, query).med?.name).toBe(expected);
  });

  it('returns no match for an unknown drug', () => {
    expect(care.findMed(h, 'warfarin').med).toBeUndefined();
  });
});

describe('schedule and dose logging', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup('07:00');
  });

  it('marks morning doses upcoming at 7:00 and due at 7:45', () => {
    expect(ctx.care.schedule(ctx.h).find((e) => e.slot === '08:00')?.state).toBe('upcoming');
    ctx.clock.setTimeOfDay('07:45');
    expect(ctx.care.schedule(ctx.h).find((e) => e.slot === '08:00')?.state).toBe('due');
  });

  it('logs a dose against the due slot and decrements supply', () => {
    ctx.clock.setTimeOfDay('08:05');
    const met = ctx.h.meds.find((m) => m.name === 'Metformin')!;
    const before = met.pillsOnHand;
    const res = ctx.care.logDose(ctx.h, ctx.june, met, 'taken');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.event.slot).toBe('08:00');
    expect(met.pillsOnHand).toBe(before - 1);
  });

  it('refuses to double-log a dose that was already taken', () => {
    ctx.clock.setTimeOfDay('08:05');
    const lis = ctx.h.meds.find((m) => m.name === 'Lisinopril')!;
    ctx.care.logDose(ctx.h, ctx.june, lis, 'taken');
    ctx.clock.setTimeOfDay('08:40');
    const again = ctx.care.logDose(ctx.h, ctx.june, lis, 'taken');
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.reason).toBe('already_logged');
  });

  it('marks a dose missed an hour after its time', () => {
    ctx.clock.setTimeOfDay('09:05');
    expect(ctx.care.schedule(ctx.h).filter((e) => e.slot === '08:00').every((e) => e.state === 'missed')).toBe(true);
  });
});

describe('scheduler', () => {
  it('reminds June at 8:00 once, then alerts Maya when the dose is an hour late', () => {
    const { clock, care, h } = setup('08:01');
    care.tick();
    care.tick();
    const reminders = care.unread(h, 'mem_june').filter((i) => i.kind === 'reminder');
    expect(reminders).toHaveLength(1);
    expect(reminders[0].detail).toContain('Lisinopril');
    expect(reminders[0].detail).toContain('Metformin');
    expect(care.unread(h, 'mem_maya').filter((i) => i.key?.startsWith('missed'))).toHaveLength(0);

    clock.setTimeOfDay('09:10');
    care.tick();
    const missed = care.unread(h, 'mem_maya').filter((i) => i.key?.startsWith('missed'));
    expect(missed).toHaveLength(1);
    expect(missed[0].title).toContain('June');
  });

  it('closes the missed alert once the late dose is logged', () => {
    const { clock, care, h, june } = setup('09:10');
    care.tick();
    expect(care.unread(h, 'mem_maya').some((i) => i.key?.startsWith('missed'))).toBe(true);
    clock.setTimeOfDay('09:20');
    for (const name of ['Lisinopril', 'Metformin']) care.logDose(h, june, h.meds.find((m) => m.name === name)!, 'taken');
    expect(care.unread(h, 'mem_maya').some((i) => i.key?.startsWith('missed'))).toBe(false);
  });

  it('flags metformin as low supply for the caregiver', () => {
    const { care, h } = setup('07:00');
    care.tick();
    const low = care.unread(h, 'mem_maya').filter((i) => i.key?.startsWith('low|med_metformin'));
    expect(low).toHaveLength(1);
  });
});

describe('adherence and summary', () => {
  it('computes last-7-day adherence from seeded history', () => {
    const { care, h } = setup('07:00');
    const a = care.adherence(h, 7);
    // 6 days of history inside the window (today has nothing judged yet at 7am), 4 doses/day, 3 missed in seed (one outside window).
    expect(a.expected).toBe(24);
    expect(a.missedDoses.length).toBeGreaterThanOrEqual(2);
    expect(a.percent).toBeGreaterThan(80);
    expect(a.percent).toBeLessThan(100);
  });

  it('builds a summary with mood series and refill flags', () => {
    const { care, h } = setup('10:00');
    const s = care.summary(h, 7);
    expect(s.person).toBe('June');
    expect(s.mood.length).toBeGreaterThan(3);
    expect(s.refills.find((r) => r.medication === 'Metformin')?.needsRefill).toBe(true);
    expect(s.today.length).toBe(4);
  });
});

describe('check-ins', () => {
  it('raises an urgent alert to Maya when June mentions a fall', () => {
    const { care, h, june } = setup('10:00');
    const res = care.checkin(h, june, 'okay', 'I fell in the bathroom but I think I am fine');
    expect(res.alerted).toBe(true);
    const alert = care.unread(h, 'mem_maya').find((i) => i.kind === 'alert' && i.severity === 'urgent');
    expect(alert?.title).toContain('fall');
  });

  it('does not alert for a good day', () => {
    const { care, h, june } = setup('10:00');
    expect(care.checkin(h, june, 'good', 'Lovely walk this morning').alerted).toBe(false);
  });
});

describe('refills', () => {
  it('quotes, places, and suppresses the low-supply alert', () => {
    const { care, h, june } = setup('10:00');
    care.tick();
    const met = h.meds.find((m) => m.name === 'Metformin')!;
    const order = care.quoteRefill(h, june, met);
    expect('error' in order).toBe(false);
    if ('error' in order) return;
    expect(order.status).toBe('pending');
    care.placeOrder(h, order, june);
    expect(order.status).toBe('placed');
    expect(care.refillStatus(h).find((r) => r.medication === 'Metformin')?.needsRefill).toBe(false);
    expect(care.unread(h, 'mem_maya').some((i) => i.key?.startsWith('low|med_metformin'))).toBe(false);
    expect(care.unread(h, 'mem_maya').some((i) => i.kind === 'order')).toBe(true);
    // A second request reports the order already on the way.
    const again = care.quoteRefill(h, june, met);
    expect('error' in again && again.error).toContain('already on the way');
  });

  it('dateKey is stable', () => {
    expect(dateKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});
