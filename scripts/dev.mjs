// Starts the Hearth MCP server and the Countertop simulator together: `npm run dev`.
import { spawn } from 'node:child_process';

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
  p.on('exit', (code) => console.log(`${name} exited (${code})`));
  return p;
});

const stop = () => {
  procs.forEach((p) => p.kill());
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
console.log('Starting Hearth (http://localhost:8787/mcp) and Countertop (http://localhost:5173) — Ctrl+C to stop.');
