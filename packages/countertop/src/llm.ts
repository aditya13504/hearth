import type { Tool } from '@modelcontextprotocol/client';
import type { ChatMessage } from './types';

/** Keys every OpenAI-compatible provider (including Gemini's) accepts in function parameters. */
const ALLOWED = new Set(['type', 'description', 'properties', 'required', 'items', 'enum', 'minimum', 'maximum', 'minItems', 'maxItems', 'nullable', 'format']);

export function sanitizeSchema(schema: any): any {
  if (Array.isArray(schema)) return schema.map(sanitizeSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out: any = {};
  for (const [k, v] of Object.entries(schema)) {
    if (!ALLOWED.has(k)) continue;
    if (k === 'properties') out.properties = Object.fromEntries(Object.entries(v as object).map(([pk, pv]) => [pk, sanitizeSchema(pv)]));
    else if (k === 'items') out.items = sanitizeSchema(v);
    else if (k === 'format' && !['date-time', 'enum'].includes(v as string)) continue;
    else out[k] = v;
  }
  // Integer constraints on "number" fields confuse some providers; plain number is fine.
  if (out.type === 'integer') out.type = 'number';
  if (out.type === 'object' && !out.properties) out.properties = {};
  return out;
}

export function toFunctions(tools: Tool[]) {
  return tools.map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description ?? t.title ?? t.name, parameters: sanitizeSchema(t.inputSchema ?? { type: 'object' }) },
  }));
}

export async function chat(messages: ChatMessage[], tools: ReturnType<typeof toFunctions>): Promise<ChatMessage> {
  const res = await fetch('/api/llm', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages, tools }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = Array.isArray(body) ? body[0]?.error : body.error;
    throw new Error(typeof err === 'string' ? err : (err?.message ?? `LLM error ${res.status}`));
  }
  const msg = body.choices?.[0]?.message as ChatMessage | undefined;
  if (!msg) throw new Error('LLM returned no message');
  return msg;
}
