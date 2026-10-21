// Records a voice sample for the demo video's narration: shows the script and records at the same time.
//   npm run voice                      (uses the first microphone)
//   npm run voice -- --device "Name"   (pick a microphone; run with --list to see them)
// Writes voice/sample.wav (git-ignored). The sample is only used locally, to clone the narration voice.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import ffmpeg from 'ffmpeg-static';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'voice', 'sample.wav');
const MAX_SECONDS = 60;

const SCRIPT = [
  'Families look after each other in small ways every day.',
  'A reminder in the morning, a quick check-in at night.',
  'Hearth brings that care to Alexa plus, so nobody has to wonder',
  "whether Mom took her pills, or whether she's okay.",
  '',
  'It runs on the Model Context Protocol, it keeps everyone in the loop,',
  'and it never orders anything without a clear yes.',
];

const c = { dim: '\x1b[2m', bold: '\x1b[1m', orange: '\x1b[38;5;214m', red: '\x1b[31m', green: '\x1b[32m', reset: '\x1b[0m' };

/** ffmpeg writes its reports to stderr, and exit codes differ between builds, so always read stderr. */
const ffmpegReport = (args) => String(spawnSync(ffmpeg, ['-hide_banner', ...args], { encoding: 'utf8' }).stderr ?? '');

function microphones() {
  const text = ffmpegReport(['-list_devices', 'true', '-f', 'dshow', '-i', 'dummy']);
  return [...text.matchAll(/"([^"]+)" \(audio\)/g)].map((m) => m[1]);
}

const args = process.argv.slice(2);
const mics = microphones();
if (args.includes('--list')) {
  console.log(mics.length ? mics.map((m) => `  ${m}`).join('\n') : 'No microphones found.');
  process.exit(0);
}
const wanted = args.includes('--device') ? args[args.indexOf('--device') + 1] : undefined;
const mic = wanted ?? mics[0];
if (!mic) {
  console.error(`${c.red}No microphone found.${c.reset} Plug one in, or check Windows Settings > Privacy > Microphone.`);
  process.exit(1);
}

const box = (lines) => {
  const width = Math.max(...lines.map((l) => l.length)) + 4;
  const bar = '─'.repeat(width);
  return [`  ╭${bar}╮`, ...lines.map((l) => `  │  ${c.bold}${l.padEnd(width - 4)}${c.reset}  │`), `  ╰${bar}╯`].join('\n');
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.clear();
console.log(`\n${c.orange}${c.bold}  Hearth — voice sample${c.reset}\n`);
console.log(`  Microphone: ${mic}`);
console.log(`  ${c.dim}Quiet room, normal pace, your natural speaking voice. About 20–30 seconds.${c.reset}\n`);
console.log(box(SCRIPT));
console.log(`\n  Press ${c.bold}Enter${c.reset} to start. Read the text above, then press ${c.bold}Enter${c.reset} again to stop.`);

const rl = readline.createInterface({ input: process.stdin });
const nextEnter = () => new Promise((r) => rl.once('line', r));
await nextEnter();
for (const n of [3, 2, 1]) {
  process.stdout.write(`\r  Starting in ${n}…   `);
  await sleep(1000);
}

mkdirSync(dirname(out), { recursive: true });
const rec = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'dshow', '-i', `audio=${mic}`, '-ac', '1', '-ar', '48000', '-t', String(MAX_SECONDS), out], {
  stdio: ['pipe', 'ignore', 'pipe'],
});
let err = '';
rec.stderr.on('data', (d) => (err += d));
const started = Date.now();
const timer = setInterval(() => {
  const s = Math.floor((Date.now() - started) / 1000);
  process.stdout.write(`\r  ${c.red}●${c.reset} Recording  ${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, '0')}   ${c.dim}(Enter to stop)${c.reset}   `);
}, 250);

await Promise.race([nextEnter(), new Promise((r) => rec.on('exit', r))]);
clearInterval(timer);
rec.stdin.write('q'); // ask ffmpeg to finish the file cleanly
await new Promise((r) => (rec.exitCode !== null ? r() : rec.on('exit', r)));
rl.close();
process.stdout.write('\n\n');

// Check what we got: length, loudness, clipping.
const stats = ffmpegReport(['-i', out, '-af', 'volumedetect', '-f', 'null', '-']);
const num = (re) => Number((stats.match(re) ?? [])[1]);
const seconds = (Date.now() - started) / 1000;
const mean = num(/mean_volume: (-?[\d.]+) dB/);
const peak = num(/max_volume: (-?[\d.]+) dB/);
let size = 0;
try {
  size = statSync(out).size;
} catch {
  /* no file */
}

if (!size) {
  console.error(`${c.red}Nothing was recorded.${c.reset} ${err.trim()}`);
  process.exit(1);
}
console.log(`  Saved ${out}`);
console.log(`  Length about ${seconds.toFixed(0)} s, average ${mean} dB, peak ${peak} dB\n`);
const problems = [];
if (seconds < 12) problems.push('It is short. 20–30 seconds gives a much closer voice match.');
if (mean < -40) problems.push('It is very quiet. Move closer to the microphone or raise the input level.');
if (peak >= -0.5) problems.push('It clipped (too loud). Move back a little.');
if (problems.length) {
  console.log(`${c.orange}  Worth re-recording:${c.reset}`);
  problems.forEach((p) => console.log(`   - ${p}`));
  console.log(`\n  Run ${c.bold}npm run voice${c.reset} again to replace it.\n`);
} else {
  console.log(`${c.green}  Looks good.${c.reset} Listen to it with:  start voice\\sample.wav\n`);
}
