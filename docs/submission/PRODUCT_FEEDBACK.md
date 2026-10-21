# Product feedback

For every tool, API and SDK used in Hearth and Countertop. AWS services were not used. I had no AWS account
available for this project, so I did not enter the AWS Builder mini challenge.

## Alexa+ add-on program (docs and the MCP-based add-on model)

- **Used for:** the product model. Hearth is designed as an Alexa+ add-on built on MCP, with a voice-first reply
  style, the recognised speaker as identity, and confirmations before purchases.
- **What worked well:**
  - Building add-ons on the **open MCP standard** is the right call. Everything I built also works in other MCP
    clients, which made development and testing far easier.
  - The hackathon FAQ clearly explained that a self-hosted MCP server plus a web-based MCP client is a valid demo path.
- **What needs work:**
  - The Category SDK, MCP Toolkit, CLI and Web Simulator are partner-only, but individual setup pages don't always
    say so. I only found out from the FAQ.
  - There is no public guidance on how Alexa+ will pass **speaker identity / account linking** to a self-hosted MCP
    server (an OAuth claim, a header, a per-person session?). I had to invent device bearer tokens.
  - There is no documentation on which 2025-11-25 features Alexa+ supports as a client: elicitation by voice,
    `resources/subscribe` for proactive notifications, MCP Apps on Echo Show, or prompts. These choices shape the
    whole design of an add-on.
- **Onboarding (zero to hello world):** about an hour for the MCP server itself. There is no Alexa+-side
  "hello world" available to the public.
- **Would I build with it again?** Yes. Voice in the kitchen is exactly where care tasks happen, and MCP makes the
  add-on portable. I'd move faster with a public simulator and a clear client-capability matrix.

## Model Context Protocol: TypeScript SDK v2 (`@modelcontextprotocol/server`, `/client`, `/node`)

- **Used for:**
  - the Hearth server: stateful Streamable HTTP sessions, tools with output schemas, resources and subscriptions,
    prompts, instructions and elicitation
  - the Countertop client: connection, elicitation handler, notification handler
  - the integration tests
- **What worked well:**
  - `registerTool` with zod v4 schemas and validated `structuredContent`.
  - `isInitializeRequest` and `NodeStreamableHTTPServerTransport` for sessions.
  - `ctx.mcpReq.elicitInput`.
  - The client's `setRequestHandler('elicitation/create')` and `setNotificationHandler`.
  - In-process end-to-end tests were easy.
  - Negotiation landed on 2025-11-25 first time.
- **What needs work:**
  - The README says v2 "implements the 2026-07-28 MCP spec", while `LATEST_PROTOCOL_VERSION` is `2025-11-25`.
  - The docs push the stateless `createMcpHandler`, where elicitation works differently (`inputRequired`). A
    developer who needs 2025-11-25 sessions with push-style elicitation and resource notifications has to piece it
    together from the sessions, protocol-versions and elicitation pages. One end-to-end "2025-11-25 stateful
    server" example would save hours.
  - `ctx.mcpReq.elicitInput` uses the default 60-second request timeout. For human-in-the-loop confirmations,
    especially by voice and with older users, that is too short, and the timeout option isn't mentioned on the
    elicitation page.
  - On the client, `callTool` has the same 60-second default while it waits on an elicitation.
- **Onboarding:** about 1.5 hours to a working stateful server with elicitation.
- **Would I build with it again?** Yes. The typing and validation are excellent.

## MCP Apps (`@modelcontextprotocol/ext-apps` v2)

- **Used for:** three `ui://` views (today, summary, refill) registered with `registerAppTool` / `registerAppResource`,
  and the host side in Countertop (`AppBridge` + `PostMessageTransport`).
- **What worked well:**
  - `app.callServerTool` from inside a view. The "I took it" button logs a dose with no model round trip.
  - `app.sendMessage` hands an action back to the assistant: "Order refill" on the summary card goes through the
    spoken confirmation.
  - `autoResize`, and host theme context.
- **What needs work:**
  - ext-apps v2 depends on the split SDK v2 packages. That is easy to miss if you start from `@modelcontextprotocol/sdk`.
  - The host example connects the bridge after the iframe exists but doesn't warn that the view sends
    `ui/initialize` as soon as its script runs. If you wait for the iframe's `load` event, the handshake is lost.
    Connect first, then set `srcdoc`.
  - Single-file views come to about 400 KB each with `app-with-deps`; a slimmer runtime would help screen devices.
- **Onboarding:** about 45 minutes to a first card, plus another hour for the host side, because the AppBridge has no
  end-to-end host example.
- **Would I build with it again?** Yes. Cards on a kitchen display are a real UX upgrade for voice.

## Agent Skills (`SKILL.md`)

- **Used for:** `skills/hearth-care`, the operating instructions loaded into the simulator's assistant at runtime.
- **Worked well:** a plain-markdown, portable format that keeps product behaviour (voice rules, safety rules,
  workflows) out of code.
- **Needs work:** guidance on how a skill and a server's `instructions` should divide responsibility, since both
  reach the model.
- **Onboarding:** minutes. It's a markdown file with a short front-matter header.
- **Would I build with it again?** Yes. It made the assistant's behaviour easy to review and change without touching
  code.

## openFDA drug label API

- **Used for:** `medication_info`, which quotes the purpose, side effects, warnings, interactions and patient
  information from the FDA label, with source and date.
- **Worked well:** free, no key needed, fast, and current label data.
- **Needs work:** a generic-name search returns combination products (for example lisinopril and
  hydrochlorothiazide) alongside single-ingredient labels, so clients must filter. The section text includes headings
  and cross-references (`[see Warnings (5.1)]`) that must be stripped before it can be spoken.
- **Onboarding:** about 15 minutes to the first useful query, with no sign-up.
- **Would I build with it again?** Yes. Authoritative, attributable medication facts are essential for a care product.

## NIH RxNav / RxNorm

- **Used for:** normalising medication names as speech recognition hears them.
- **Worked well:** `approximateTerm` fixes typos well ("lisinoprl"). Ingredient resolution through `related?tty=IN`
  is reliable.
- **Needs work:** multi-word mis-hearings ("met for men") match brand combinations (Actoplus Met). I had to also
  query a joined-up spelling of the words and rank candidates by spelling distance.
- **Onboarding:** about 20 minutes, with no key needed. Mapping a candidate to its ingredient took some reading of the
  term types.
- **Would I build with it again?** Yes. It is the right tool for checking medication names said out loud.

## Web Speech API (Edge and Chrome)

- **Used for:** push-to-talk recognition and spoken replies in Countertop.
- **Worked well:** zero setup, and Edge's natural voices sound good.
- **Needs work:** it is not available in Firefox, and recognition needs a network connection.
- **Onboarding:** minutes.
- **Would I build with it again?** Yes, for prototypes and simulators. A real device would use Alexa's own speech
  stack.

## LLM providers (Groq, Google Gemini via OpenAI-compatible endpoints)

- **Used for:** the simulator's assistant.
- **Worked well:** Groq answers in under a second, which suits voice. Gemini 3 Flash is good at tool calling.
- **Needs work:**
  - Gemini's free tier is 20 requests per model per day.
  - Gemini rejects `reasoning_effort: "none"` on flash-lite with a bare "invalid argument".
  - Gemini 3 thought signatures must be echoed back, which breaks conversations that switch providers. Google's
    documented placeholder signature fixes it.
  - Groq's free tier is 8,000 tokens per minute per model, so prompts had to be trimmed and requests rotated.
- **Onboarding:** about 10 minutes each, using OpenAI-compatible endpoints. Discovering the free-tier limits took
  longer than the integration.
- **Would I build with them again?** Yes. Groq for speed in voice turns, and Gemini as a capable fallback.

## Express, zod, Vite and Vitest

- **Used for:**
  - Express: the HTTP layer for the MCP server and the simulator's small server.
  - zod v4: tool input and output schemas.
  - Vite: the simulator and the single-file MCP Apps views, via `vite-plugin-singlefile`.
  - Vitest: 49 tests, including end-to-end MCP tests.
- **What worked well:** zod v4 schemas plug straight into the MCP SDK's `registerTool`. Vite's middleware mode lets
  one Node server host the app, the API and live reload.
- **What needs work:** Vite's live-reload websocket defaults to a fixed port (24678), which collides when two dev
  servers run. Attaching it to the app's own HTTP server fixed that.
- **Onboarding:** familiar tools, so minutes.
- **Would I build with them again?** Yes.

## Claude Code

- **Used for:** building the project (design, implementation, tests, browser-driven end-to-end checks, docs).
- **What worked well:** it drove the real app in a browser to find layout and safety bugs that unit tests alone would
  have missed.
- **What needs work:** long tasks needed explicit checks, which I gave as tests and screenshots, before I could
  trust "done".
- **Onboarding:** immediate.
- **Would I build with it again?** Yes.
