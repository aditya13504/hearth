/**
 * Create a real household for production mode and print each person's device token (shown once).
 *
 *   npm run setup -w hearth-server -- --household "Lee family" --recipient "Ruth:Mom" --caregiver "Sam:son"
 *
 * Medications are then added by voice or from a caregiver's device with the add_medication tool,
 * which checks each name against RxNorm.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { type Db, type Household, hashToken, type Member, newId, newToken, saveDb } from './store.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_PRODUCTION_DATA = join(root, 'data', 'household.json');

const HELP = `Create a Hearth household (production mode).

Usage:
  npm run setup -w hearth-server -- --household "Lee family" --recipient "Ruth:Mom" --caregiver "Sam:son" [--caregiver "Ana:granddaughter"]

Options:
  --household <name>        Household name (required)
  --recipient <name[:rel]>  The person being cared for, and what the family calls them (required)
  --caregiver <name[:rel]>  A family member or carer; repeat for more than one (at least one)
  --pharmacy <name>         Pharmacy shown on refill orders (refills are simulated until a pharmacy is connected)
  --file <path>             Data file (default: HEARTH_DATA or data/household.json). Existing households are kept.

Then start the server with:  HEARTH_MODE=production npm start -w hearth-server`;

export interface SetupResult {
  file: string;
  household: Household;
  tokens: Array<{ member: Member; token: string }>;
}

const person = (spec: string, role: Member['role']): Member => {
  const [name, relationship] = spec.split(':').map((s) => s.trim());
  if (!name) throw new Error(`Missing a name in "${spec}"`);
  return { id: newId('mem'), name, role, relationship: relationship || undefined };
};

export function createHousehold(opts: { file: string; household: string; recipient: string; caregivers: string[]; pharmacy?: string }): SetupResult {
  if (!opts.household || !opts.recipient || opts.caregivers.length === 0) throw new Error('--household, --recipient and at least one --caregiver are required.');
  let db: Db = { version: 1, kind: 'production', households: [] };
  if (existsSync(opts.file)) {
    const saved = JSON.parse(readFileSync(opts.file, 'utf8')) as Db;
    if (saved.kind !== 'production') throw new Error(`${opts.file} holds demo data. Choose a new --file for a real household.`);
    db = saved;
  }
  const members = [person(opts.recipient, 'recipient'), ...opts.caregivers.map((c) => person(c, 'caregiver'))];
  const tokens = members.map((member) => ({ member, token: newToken() }));
  const household: Household = {
    id: newId('hh'),
    name: opts.household,
    members,
    tokens: Object.fromEntries(tokens.map((t) => [hashToken(t.token), t.member.id])),
    pharmacy: { name: opts.pharmacy ?? 'Pharmacy (simulated, no real orders)', deliveryNote: 'delivered tomorrow' },
    meds: [],
    doses: [],
    checkins: [],
    inbox: [],
    orders: [],
  };
  db.households.push(household);
  saveDb(opts.file, db);
  return { file: opts.file, household, tokens };
}

function main() {
  const { values } = parseArgs({
    options: {
      household: { type: 'string' },
      recipient: { type: 'string' },
      caregiver: { type: 'string', multiple: true },
      pharmacy: { type: 'string' },
      file: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help || !values.household) {
    console.log(HELP);
    process.exit(values.help ? 0 : 1);
  }
  const file = resolve(values.file ?? process.env.HEARTH_DATA ?? DEFAULT_PRODUCTION_DATA);
  try {
    const result = createHousehold({ file, household: values.household!, recipient: values.recipient ?? '', caregivers: values.caregiver ?? [], pharmacy: values.pharmacy });
    console.log(`\nCreated "${result.household.name}" in ${result.file}\n`);
    console.log('Device tokens (shown once; only their hashes are stored). Give each person their own:\n');
    for (const { member, token } of result.tokens) {
      console.log(`  ${member.name.padEnd(14)} ${member.role.padEnd(10)} ${token}`);
    }
    console.log('\nStart Hearth:   HEARTH_MODE=production npm start -w hearth-server');
    console.log('Connect a client, e.g. Claude Code:');
    console.log(`  claude mcp add --transport http hearth http://localhost:8787/mcp --header "Authorization: Bearer ${result.tokens[1].token}"`);
    console.log('Then add medicines by voice: "Add lisinopril 10 mg every morning at 8, it\'s for blood pressure."\n');
  } catch (err) {
    console.error(`Setup failed: ${(err as Error).message}`);
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
