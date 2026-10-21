// Countertop server: serves the simulator UI, its device config, and an LLM proxy so the
// API key stays on the server. The MCP connections themselves are made by the browser.
import express from 'express';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const prod = process.env.NODE_ENV === 'production';

/** Minimal .env loader: looks in this package, then walks up to the repo root. */
function loadEnv() {
  let dir = here;
  for (let i = 0; i < 4; i++) {
    const file = join(dir, '.env');
    if (existsSync(file)) {
      for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    }
    dir = dirname(dir);
  }
}
loadEnv();

const LLM = {
  baseUrl: (process.env.LLM_BASE_URL ?? 'https://generativelanguage.googleapis.com/v1beta/openai').replace(/\/$/, ''),
  model: process.env.LLM_MODEL ?? 'gemini-3.5-flash',
  fallbackModel: process.env.LLM_FALLBACK_MODEL ?? 'gemini-3.5-flash-lite',
  reasoningEffort: process.env.LLM_REASONING_EFFORT ?? 'none',
  // Lighter models reject "none"; "minimal" is the fastest setting they accept.
  fallbackReasoningEffort: process.env.LLM_FALLBACK_REASONING_EFFORT ?? 'minimal',
  key: process.env.LLM_API_KEY ?? '',
};

const configPath = resolve(process.env.COUNTERTOP_CONFIG ?? join(here, 'countertop.config.json'));
function loadConfig() {
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  // Agent Skills (SKILL.md files) are loaded at runtime and given to the assistant as instructions.
  config.skills = (config.skills ?? []).map((p) => {
    const file = resolve(dirname(configPath), p);
    return { path: p, content: existsSync(file) ? readFileSync(file, 'utf8') : '' };
  });
  config.llm = { model: LLM.model, configured: Boolean(LLM.key) };
  return config;
}

const app = express();
app.use(express.json({ limit: '4mb' }));

app.get('/api/config', (_req, res) => res.json(loadConfig()));

async function complete(body, model, reasoningEffort) {
  const payload = { ...body, model };
  if (reasoningEffort && reasoningEffort !== 'default') payload.reasoning_effort = reasoningEffort;
  return fetch(`${LLM.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${LLM.key}` },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(60_000),
  });
}

app.post('/api/llm', async (req, res) => {
  if (!LLM.key) return res.status(500).json({ error: 'LLM_API_KEY is not set. Add it to .env (see README).' });
  const { messages, tools } = req.body ?? {};
  try {
    const body = { messages, tools: tools?.length ? tools : undefined };
    const busy = (r) => [429, 500, 503].includes(r.status);
    let upstream = await complete(body, LLM.model, LLM.reasoningEffort);
    // Free tiers get busy: retry once, then fall back to a lighter model rather than leave someone waiting.
    if (busy(upstream)) {
      await new Promise((r) => setTimeout(r, 800));
      upstream = await complete(body, LLM.model, LLM.reasoningEffort);
    }
    if (busy(upstream) && LLM.fallbackModel) {
      console.warn(`[countertop] ${LLM.model} returned ${upstream.status}, using ${LLM.fallbackModel}`);
      upstream = await complete(body, LLM.fallbackModel, LLM.fallbackReasoningEffort);
    }
    const text = await upstream.text();
    if (!upstream.ok) {
      console.warn(`[countertop] LLM ${upstream.status}: ${text.slice(0, 300)}`);
      if (process.env.COUNTERTOP_DEBUG) {
        const { appendFileSync } = await import('node:fs');
        appendFileSync(join(here, 'llm-errors.jsonl'), JSON.stringify({ status: upstream.status, text, messages, tools }) + '\n');
      }
    }
    res.status(upstream.status).type('application/json').send(text);
  } catch (err) {
    res.status(502).json({ error: String(err) });
  }
});

if (prod) {
  app.use(express.static(join(here, 'dist')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ root: here, server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}

const port = Number(process.env.COUNTERTOP_PORT ?? 5173);
app.listen(port, () => {
  console.log(`[countertop] http://localhost:${port}  (config: ${configPath}, model: ${LLM.model}${LLM.key ? '' : ' — LLM_API_KEY missing!'})`);
});
