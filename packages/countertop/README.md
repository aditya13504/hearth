# Countertop

**An open-source, browser-based voice assistant simulator for testing MCP servers.** Point it at any
[Model Context Protocol](https://modelcontextprotocol.io) server, then talk to it the way people will talk to it
through a voice assistant such as Alexa+. You can see every protocol message while you do.

![Countertop simulating a kitchen display and a phone talking to the same MCP server](docs/countertop.png)

## Why

Voice assistants are becoming MCP clients. Alexa+ add-ons, for example, are built on MCP. But the official
device-side developer tools are often in private preview, and generic MCP inspectors don't show what an MCP server
is like *to use by voice*:
- Are the replies short enough to say out loud?
- Do confirmations work by voice?
- Does a card show up on a screen device?
- Does a proactive reminder actually reach the person?

Countertop gives you that loop on your own machine, with any LLM.

## Features

- **Real MCP client in the browser**: `initialize`, `tools/list`, `tools/call`, `resources/*` and `prompts/*` over
  **Streamable HTTP**, with protocol **2025-11-25**. Built on the official MCP TypeScript SDK v2.
- **Several simulated devices side by side**, for example a kitchen display and a phone. Each device has its own MCP
  session and bearer token, which lets you test multi-user servers where people share state.
- **Voice in and out** through the Web Speech API (Edge and Chrome), plus text input and one-tap suggestion chips for
  repeatable demos.
- **MCP Apps host**: tools that declare `_meta.ui.resourceUri` render their `ui://` view in a sandboxed iframe. The
  views run on the official `AppBridge`, so they can call server tools or send messages back to the assistant.
- **Elicitation**: `elicitation/create` requests appear as an on-device confirmation that can be answered by voice.
  Only a short, clear "yes" or "no" counts. Anything else cancels the confirmation and is handled as a new request,
  so *"I fell but I'm okay"* never approves an order.
- **Proactive notifications**: Countertop subscribes to resources that describe themselves as subscribable. On
  `notifications/resources/updated` it plays a chime, shows a toast, and has the assistant announce the news.
- **Agent Skills**: `SKILL.md` files listed in the config become the assistant's operating instructions, together
  with the server's `instructions`.
- **Guardrail against claimed actions**: if the model says "I've logged it" without calling a tool, the reply is held
  back and the model is sent back to actually do it.
- **Protocol inspector**: every JSON-RPC message, in both directions, for every device, with timestamps and
  expandable payloads.
- **Any OpenAI-compatible LLM**: Groq, Gemini, OpenAI, OpenRouter, a local Ollama, and so on. Keys stay on the small
  Node server, never in the page. A route chain fails over on rate limits, which suits free tiers.
- **Demo clock controls** (optional), for servers with time-based behaviour.

## Quick start

```bash
git clone https://github.com/aditya13504/countertop.git
cd countertop
npm install
cp .env.example .env              # add GROQ_API_KEY or LLM_API_KEY
# countertop.config.json is set up for Hearth; for your own server start from countertop.config.example.json
npm run dev                       # http://localhost:5173
```

Your MCP server must serve Streamable HTTP and allow CORS from the Countertop origin, exposing the
`Mcp-Session-Id` header.

## Configuration (`countertop.config.json`)

```jsonc
{
  "title": "My server on Countertop",
  "skills": ["./skills/my-skill/SKILL.md"],          // optional Agent Skills
  "voice": { "preferred": ["Ava Online (Natural)"] }, // optional TTS voice preference
  "demo": {                                          // optional: a clock your server exposes
    "url": "http://localhost:8787/demo",             // GET /state -> {now}, POST /clock {time|advanceMinutes}, POST /reset
    "presets": [{ "label": "8:00 AM", "time": "08:00" }]
  },
  "devices": [
    {
      "id": "kitchen",
      "label": "Kitchen display",
      "variant": "display",                          // "display" (landscape, cards fill the screen) or "phone"
      "owner": "June",                               // who the assistant is talking to
      "mcpUrl": "http://localhost:8787/mcp",
      "token": "optional-bearer-token",
      "suggestions": ["What do I need to take now?"]
    }
  ]
}
```

**Notification resources.** Countertop subscribes to every resource whose description mentions "subscribe". When one
updates, it reads it and expects a JSON array of `{ id, title, detail, severity?, kind? }` items. New ids are
announced.

## LLM configuration (`.env`)

| Variable | Meaning |
|---|---|
| `GROQ_API_KEY`, `GROQ_MODELS` | Groq, tried first. Default models: `qwen/qwen3.8-27b,openai/gpt-oss-120b,openai/gpt-oss-20b` |
| `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`, `LLM_FALLBACK_MODELS` | Any OpenAI-compatible endpoint (default: Google Gemini) |
| `LLM_REASONING_EFFORT` | Passed through as `reasoning_effort` |
| `COUNTERTOP_CONFIG`, `COUNTERTOP_PORT` | Config path and port |

## How it works

- `src/mcp.ts` connects each device with `StreamableHTTPClientTransport`, wrapped in a logging transport for the
  inspector. It advertises the `elicitation` capability and MCP Apps support.
- `src/device.ts` runs the agent loop:
  1. The server's tools become functions for the model.
  2. Tool calls run against the MCP server.
  3. Tools that have UI resources render as cards.
  4. Replies are spoken.
  5. Elicitation and resource-update handlers sit on the same client.
- `src/apphost.ts` is the MCP Apps host (`AppBridge` + `PostMessageTransport`).
- `server.mjs` serves the app and proxies chat completions to the route chain.

## Origin

Countertop was built for [Hearth](https://github.com/aditya13504/hearth), an Alexa+ care-companion MCP server, during
the *Build, Ship, Shape* Amazon Developer Hackathon (2026). It is generic: nothing in it is specific to Hearth.

## License

MIT
