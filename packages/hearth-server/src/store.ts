import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
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
  /** When the medication was added. Doses scheduled before this never count as due or missed. */
  startsAt?: string;
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
  /** Set when a caregiver reported this on the person's behalf ("Mom told me she fell"). */
  reportedBy?: string;
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
  /**
   * Device token -> member id. Real households store only SHA-256 hashes ("sha256:<hex>") of the tokens
   * handed out by `npm run setup`; the demo household uses readable tokens.
   */
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
  /** 'demo' data is regenerated every day so the story always lines up; 'production' data is never touched. */
  kind?: 'demo' | 'production';
  /** Day the demo history was generated for. */
  seededOn?: string;
  households: Household[];
}

export const hashToken = (token: string) => `sha256:${createHash('sha256').update(token).digest('hex')}`;
/** A long random device token (256 bits), safe to put in a URL or header. */
export const newToken = () => `hth_${randomBytes(32).toString('base64url')}`;

let counter = 0;
export function newId(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}`;
}

/** Write to a temporary file and rename it over the old one, so a crash can never leave half a file. */
export function saveDb(file: string, db: Db): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(db, null, 2));
  renameSync(tmp, file);
}

export class Store {
  db: Db;

  /**
   * Demo mode: load the demo household, regenerating it when its history is from another day.
   * Production mode: load real households exactly as saved, and refuse to start without them.
   */
  constructor(
    private readonly file: string | null,
    seedNow: Date,
    readonly mode: 'demo' | 'production' = 'demo',
  ) {
    const saved = file && existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Db) : null;
    if (mode === 'production') {
      if (!saved || saved.kind !== 'production') {
        throw new Error(
          saved
            ? `${file} holds demo data. Production mode needs a real household: run "npm run setup -w hearth-server" with HEARTH_DATA pointing to a new file.`
            : `No household data at ${file}. Create one first: npm run setup -w hearth-server -- --help`,
        );
      }
      this.db = saved;
      return;
    }
    if (saved && saved.kind !== 'production' && saved.seededOn === dateKey(seedNow)) {
      this.db = saved;
    } else if (saved?.kind === 'production') {
      throw new Error(`${file} holds real household data. Start Hearth with HEARTH_MODE=production, or point HEARTH_DATA at another file for the demo.`);
    } else {
      this.db = seed(seedNow);
      this.save();
    }
  }

  reset(seedNow: Date): void {
    if (this.mode === 'production') throw new Error('Refusing to reset real household data.');
    this.db = seed(seedNow);
    this.save();
  }

  save(): void {
    if (this.file) saveDb(this.file, this.db);
  }

  household(id: string): Household {
    const h = this.db.households.find((x) => x.id === id);
    if (!h) throw new Error(`Unknown household ${id}`);
    return h;
  }

  /** Resolve a bearer token to its household and member. */
  identify(token: string): { household: Household; member: Member } | null {
    if (!token) return null;
    const hashed = hashToken(token);
    for (const household of this.db.households) {
      const memberId = household.tokens[hashed] ?? (this.mode === 'demo' ? household.tokens[token] : undefined);
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
    kind: 'demo',
    seededOn: today,
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
