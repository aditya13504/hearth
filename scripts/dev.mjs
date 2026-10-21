// Starts the Hearth MCP server and the Countertop simulator together: `npm run dev`.
// If either one fails to start (for example its port is taken), both are stopped so nothing is left half-running.
import { spawn } from 'node:child_process';

let stopping = false;
const procs = [
  ['hearth', 'npm', ['run', 'dev', '-w', 'hearth-server']],
  ['countertop', 'npm', ['run', 'dev', '-w', 'countertop']],
].map(([name, cmd, args]) => {
  const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32', env: process.env });
  const prefix = (chunk) =>
    chunk
      .toString()
      .split(/\r?\n/)
      .filter(Boolean)
      .forEach((line) => console.log(`${name.padEnd(10)} | ${line}`));
  p.stdout.on('data', prefix);
  p.stderr.on('data', prefix);
  p.on('exit', (code) => {
    if (stopping) return;
    console.log(`${name} stopped${code ? ` (exit code ${code})` : ''}. Stopping the other server too.`);
    stop(code ?? 1);
  });
  return p;
});

function stop(code = 0) {
  stopping = true;
  for (const p of procs) {
    if (p.exitCode !== null) continue;
    // On Windows the npm shell wrapper doesn't forward signals, so end the whole process tree.
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore' });
    else p.kill();
  }
  setTimeout(() => process.exit(code), 300);
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
console.log('Starting Hearth (http://localhost:8787/mcp) and Countertop (http://localhost:5173) — Ctrl+C to stop.');
