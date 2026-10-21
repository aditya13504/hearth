import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { addDays, dateKey } from './clock.js';

export type Role = 'recipient' | 'caregiver';

export interface Member {
  id: string;
  name: string;
  role: Role;
  /** How the household refers to this person, e.g. "Mom". */
  relationship?: string;
}

export interface Medication {
  id: string;
  name: string;
  rxcui?: string;
  strength: string;
  form: string;
  /** Plain-language reason, as the prescriber explained it. */
  purpose: string;
  /** What the pill looks like, so it can be identified by voice ("the small pink one"). */
  looks: string;
  instructions?: string;
  times: string[];
  pillsPerDose: number;
  pillsOnHand: number;
  refillsRemaining: number;
  /** 30-day refill price at the (simulated) pharmacy, in USD. */
  refillPrice: number;
  refillQuantity: number;
  active: boolean;
}

export type DoseStatus = 'taken' | 'skipped';

export interface DoseEvent {
  id: string;
  medId: string;
  day: string;
  slot: string;
  status: DoseStatus;
  at: string;
  by: string;
  note?: string;
}

export type Mood = 'great' | 'good' | 'okay' | 'not_great' | 'bad';

export interface Checkin {
  id: string;
  at: string;
  memberId: string;
  mood: Mood;
  note?: string;
  flags: string[];
}

export type InboxKind = 'reminder' | 'alert' | 'message' | 'order';

export interface InboxItem {
  id: string;
  /** Member who should see it. */
  to: string;
  from?: string;
  kind: InboxKind;
  severity: 'info' | 'warning' | 'urgent';
  title: string;
  detail: string;
  at: string;
  readAt?: string;
  /** De-duplication key so the scheduler never raises the same reminder twice. */
  key?: string;
}

export interface Order {
  id: string;
  medId: string;
  quantity: number;
  price: number;
  pharmacy: string;
  status: 'pending' | 'placed' | 'declined';
  createdAt: string;
  placedAt?: string;
  eta?: string;
  requestedBy: string;
}

export interface Household {
  id: string;
  name: string;
  members: Member[];
  /** Bearer token -> member id. Demo-grade identity; a real add-on would use account linking. */
  tokens: Record<string, string>;
  pharmacy: { name: string; deliveryNote: string };
  meds: Medication[];
  doses: DoseEvent[];
  checkins: Checkin[];
  inbox: InboxItem[];
  orders: Order[];
}

export interface Db {
  version: 1;
  households: Household[];
}

let counter = 0;
export function newId(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}`;
}

export class Store {
  db: Db;

  constructor(private readonly file: string | null, seedNow: Date) {
    if (file && existsSync(file)) {
      this.db = JSON.parse(readFileSync(file, 'utf8')) as Db;
    } else {
      this.db = seed(seedNow);
      this.save();
    }
  }

  reset(seedNow: Date): void {
    this.db = seed(seedNow);
    this.save();
  }

  save(): void {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.db, null, 2));
  }

  household(id: string): Household {
    const h = this.db.households.find((x) => x.id === id);
    if (!h) throw new Error(`Unknown household ${id}`);
    return h;
  }

  /** Resolve a bearer token to its household and member. */
  identify(token: string): { household: Household; member: Member } | null {
    for (const household of this.db.households) {
      const memberId = household.tokens[token];
      if (memberId) {
        const member = household.members.find((m) => m.id === memberId);
        if (member) return { household, member };
      }
    }
    return null;
  }
}

/**
 * The demo household: June (79) lives alone; her daughter Maya lives two hours away.
 * Seven days of history are generated relative to `now` so the weekly summary has real shape:
 * mostly good adherence, a couple of missed evening doses, and a dip in mood mid-week.
 */
export function seed(now: Date): Db {
  const today = dateKey(now);
  const meds: Medication[] = [
    {
      id: 'med_lisinopril',
      name: 'Lisinopril',
      rxcui: '29046',
      strength: '10 mg',
      form: 'tablet',
      purpose: 'blood pressure',
      looks: 'small pink round tablet',
      instructions: 'once every morning',
      times: ['08:00'],
      pillsPerDose: 1,
      pillsOnHand: 23,
      refillsRemaining: 3,
      refillPrice: 4.0,
      refillQuantity: 30,
      active: true,
    },
    {
      id: 'med_metformin',
      name: 'Metformin',
      rxcui: '6809',
      strength: '500 mg',
      form: 'tablet',
      purpose: 'blood sugar',
      looks: 'large white oval tablet',
      instructions: 'with breakfast and with dinner',
      times: ['08:00', '18:00'],
      pillsPerDose: 1,
      pillsOnHand: 9,
      refillsRemaining: 2,
      refillPrice: 4.0,
      refillQuantity: 60,
      active: true,
    },
    {
      id: 'med_atorvastatin',
      name: 'Atorvastatin',
      rxcui: '83367',
      strength: '20 mg',
      form: 'tablet',
      purpose: 'cholesterol',
      looks: 'white oval tablet with "20" on it',
      instructions: 'at bedtime',
      times: ['21:00'],
      pillsPerDose: 1,
      pillsOnHand: 41,
      refillsRemaining: 5,
      refillPrice: 7.5,
      refillQuantity: 30,
      active: true,
    },
  ];

  // Doses June missed in the past week (day offset, med, slot). Everything else was taken on time-ish.
  const missed = new Set(['-5|med_metformin|18:00', '-2|med_metformin|18:00', '-2|med_atorvastatin|21:00']);
  const doses: DoseEvent[] = [];
  for (let offset = -7; offset <= -1; offset++) {
    const day = addDays(today, offset);
    for (const med of meds) {
      for (const slot of med.times) {
        if (missed.has(`${offset}|${med.id}|${slot}`)) continue;
        const [h, m] = slot.split(':').map(Number);
        const lateBy = (Math.abs(offset * 7 + h) % 4) * 6; // 0-18 minutes, deterministic
        const at = new Date(`${day}T00:00:00`);
        at.setHours(h, m + lateBy);
        doses.push({ id: newId('dose'), medId: med.id, day, slot, status: 'taken', at: at.toISOString(), by: 'mem_june' });
      }
    }
  }

  const moodByOffset: Record<number, [Mood, string?]> = {
    [-7]: ['good'],
    [-6]: ['good', 'Walked to the mailbox and back.'],
    [-5]: ['okay', 'Tired in the evening.'],
    [-4]: ['good'],
    [-3]: ['not_great', 'Knee is sore today.'],
    [-2]: ['okay', 'Slept badly.'],
    [-1]: ['good', 'Maya called, felt nice.'],
  };
  const checkins: Checkin[] = Object.entries(moodByOffset).map(([offset, [mood, note]]) => {
    const at = new Date(`${addDays(today, Number(offset))}T09:15:00`);
    return { id: newId('chk'), at: at.toISOString(), memberId: 'mem_june', mood, note, flags: [] };
  });

  return {
    version: 1,
    households: [
      {
        id: 'hh_alvarez',
        name: 'Alvarez family',
        members: [
          { id: 'mem_june', name: 'June', role: 'recipient', relationship: 'Mom' },
          { id: 'mem_maya', name: 'Maya', role: 'caregiver', relationship: 'daughter' },
        ],
        tokens: {
          'june-kitchen-echo': 'mem_june',
          'maya-phone': 'mem_maya',
        },
        pharmacy: { name: 'Corner Pharmacy (simulated)', deliveryNote: 'delivered tomorrow by 2 PM' },
        meds,
        doses,
        checkins,
        inbox: [],
        orders: [],
      },
    ],
  };
}
