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

/**
 * Ordered list of OpenAI-compatible chat endpoints to try. Free tiers are rate-limited per model,
 * so a request walks down the list, and a route that answered 429 is skipped until its cooldown ends.
 *
 *   GROQ_API_KEY   -> Groq (fast; comma-separated GROQ_MODELS)
 *   LLM_API_KEY    -> LLM_BASE_URL (default Gemini) with LLM_MODEL plus comma-separated LLM_FALLBACK_MODELS
 */
function buildRoutes() {
  const routes = [];
  const gemini = 'https://generativelanguage.googleapis.com/v1beta/openai';
  if (process.env.GROQ_API_KEY) {
    // Groq's free tier limits tokens per minute per model, so several models share the load.
    const models = (process.env.GROQ_MODELS ?? 'qwen/qwen3.8-27b,openai/gpt-oss-120b,openai/gpt-oss-20b').split(',');
    for (const model of models.filter(Boolean)) {
      routes.push({ name: 'groq', baseUrl: 'https://api.groq.com/openai/v1', key: process.env.GROQ_API_KEY, model: model.trim() });
    }
  }
  if (process.env.LLM_API_KEY) {
    const baseUrl = (process.env.LLM_BASE_URL ?? gemini).replace(/\/$/, '');
    const isGemini = baseUrl.includes('generativelanguage');
    const models = [
      process.env.LLM_MODEL ?? (isGemini ? 'gemini-3.5-flash' : 'gpt-4.1-mini'),
      ...(process.env.LLM_FALLBACK_MODELS ?? (isGemini ? 'gemini-3.8-flash,gemini-3.7-flash,gemini-2.5-flash' : '')).split(','),
    ].filter(Boolean);
    for (const model of models) {
      routes.push({
        name: isGemini ? 'gemini' : 'llm',
        baseUrl,
        key: process.env.LLM_API_KEY,
        model: model.trim(),
        // Gemini 3 models think by default; "none" keeps voice replies fast. 2.x models take "low".
        reasoningEffort: process.env.LLM_REASONING_EFFORT ?? (isGemini ? (/gemini-2/.test(model) ? 'low' : 'none') : undefined),
      });
    }
  }
  return routes;
}
const routes = buildRoutes();
const cooldownUntil = new Map();

const configPath = resolve(process.env.COUNTERTOP_CONFIG ?? join(here, 'countertop.config.json'));
function loadConfig() {
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  // Agent Skills (SKILL.md files) are loaded at runtime and given to the assistant as instructions.
  config.skills = (config.skills ?? []).map((p) => {
    const file = resolve(dirname(configPath), p);
    return { path: p, content: existsSync(file) ? readFileSync(file, 'utf8') : '' };
  });
  const names = routes.map((r) => r.model.split('/').pop());
  config.llm = { model: names.length > 1 ? `${names[0]} + ${names.length - 1} fallbacks` : (names[0] ?? 'none'), configured: routes.length > 0 };
  return config;
}

const app = express();
app.use(express.json({ limit: '4mb' }));

app.get('/api/config', (_req, res) => res.json(loadConfig()));

/** Providers differ in which message fields they accept; send only the portable ones (plus Gemini's own). */
function portableMessages(messages, route) {
  return messages.map((m) => {
    const out = { role: m.role, content: m.content ?? (m.tool_calls ? null : '') };
    if (m.tool_calls) {
      out.tool_calls = m.tool_calls.map((c) => {
        const call = { id: c.id, type: 'function', function: { name: c.function.name, arguments: c.function.arguments } };
        // Gemini 3 needs its thought signatures echoed back on later turns. Calls made by another
        // provider have none; Google documents this placeholder for injected/transferred calls.
        if (route.name === 'gemini') {
          call.extra_content = c.extra_content?.google?.thought_signature
            ? c.extra_content
            : { google: { thought_signature: 'skip_thought_signature_validator' } };
        }
        return call;
      });
    }
    if (m.tool_call_id) out.tool_call_id = m.tool_call_id;
    if (m.role === 'tool' && m.name) out.name = m.name;
    return out;
  });
}

async function complete(route, messages, tools) {
  const payload = { model: route.model, messages: portableMessages(messages, route), tools: tools?.length ? tools : undefined };
  if (route.reasoningEffort) payload.reasoning_effort = route.reasoningEffort;
  if (route.name === 'groq') payload.parallel_tool_calls = true;
  const started = Date.now();
  try {
    const res = await fetch(`${route.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${route.key}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(25_000),
    });
    console.log(`[countertop] llm ${route.name}/${route.model} ${res.status} ${Date.now() - started}ms`);
    return res;
  } catch (err) {
    // Network error or timeout: treat like a busy upstream so the next route is tried.
    console.warn(`[countertop] llm ${route.name}/${route.model} failed after ${Date.now() - started}ms: ${err}`);
    return new Response(JSON.stringify({ error: String(err) }), { status: 503 });
  }
}

app.post('/api/llm', async (req, res) => {
  if (routes.length === 0) return res.status(500).json({ error: 'No LLM configured. Set GROQ_API_KEY or LLM_API_KEY in .env (see README).' });
  const { messages, tools } = req.body ?? {};
  const now = Date.now();
  const available = routes.filter((r) => (cooldownUntil.get(r) ?? 0) <= now);
  let last = null;
  for (const route of available.length ? available : routes) {
    const upstream = await complete(route, messages, tools);
    const text = await upstream.text();
    if (upstream.ok) return res.status(200).type('application/json').send(text);
    last = { status: upstream.status, text };
    console.warn(`[countertop] ${route.model} -> ${upstream.status}: ${text.slice(0, 200).replace(/\s+/g, ' ')}`);
    if (process.env.COUNTERTOP_DEBUG) {
      const { appendFileSync } = await import('node:fs');
      appendFileSync(join(here, 'llm-errors.jsonl'), JSON.stringify({ route: route.model, status: upstream.status, text, messages, tools }) + '\n');
    }
    // Daily quota gone: park this route for an hour. Per-minute limits and overload: a short pause.
    if (upstream.status === 429) {
      const retryIn = text.match(/try again in (?:(\d+)m)?([\d.]+)s/i);
      const waitMs = /per ?day|PerDay/i.test(text) ? 3_600_000 : retryIn ? (Number(retryIn[1] ?? 0) * 60 + Number(retryIn[2])) * 1000 + 250 : 20_000;
      cooldownUntil.set(route, Date.now() + waitMs);
    }
    else if (upstream.status >= 500) cooldownUntil.set(route, Date.now() + 15_000);
    else break; // 4xx other than 429 is our request's fault; another model won't fix it.
  }
  res.status(last?.status ?? 502).type('application/json').send(last?.text ?? JSON.stringify({ error: 'All models are busy' }));
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
  console.log(`[countertop] http://localhost:${port}  (config: ${configPath}, models: ${routes.map((r) => r.model).join(" → ") || "NONE — set GROQ_API_KEY or LLM_API_KEY"})`);
});
