# Hearth: an Alexa+ care companion (design)

Date: 2026-10-21. Hackathon: Build, Ship, Shape (Amazon Developer). Deadline: 2026-10-23 12:00 PT.
Track: **Alexa+**, via a self-hosted MCP server plus a simulated Alexa+ experience. Mini challenge: **Open Source**.
The AWS Builder challenge is out of scope because there is no billed AWS account.

## Intent

About 53 million US adults care for an older family member. Most of that care is small, daily work: did Mom take
her pills, is she running low, how has she been feeling this week. Amazon retired Alexa Together in 2024, and
nothing has filled that gap. Hearth is an Alexa+ add-on that serves both people involved:

- **The care recipient** (June, 79, at home with an Echo Show) uses voice only. Hearth reminds her about doses,
  logs them, answers "what is this pill for?" from the FDA label, and handles refills with a spoken confirmation.
- **The caregiver** (Maya, her daughter, living elsewhere) asks Alexa or her phone "how's Mom doing?" and gets a
  real weekly picture. Hearth also escalates to Maya when a dose is missed or June reports feeling unwell.

Both people talk to **the same MCP server**, with different identities. State persists across sessions, devices
and people. That cross-session memory is the core of the idea.

## Judging criteria to design decisions

| Criterion | How Hearth earns it |
|---|---|
| Tech implementation | MCP spec **2025-11-25** over Streamable HTTP, built on the TS SDK v2. It uses tools with output schemas and structured content, resources with subscriptions (proactive reminders), prompts, **elicitation** for purchase confirmation, **MCP Apps** UI cards, and server `instructions`. It calls real external services (RxNorm, openFDA). Tests cover the protocol end to end. |
| Design | Voice-first: short spoken replies, confirmations before anything irreversible, and big cards readable from across a kitchen. Two devices show the shared state live. A protocol inspector proves that real MCP traffic is flowing. |
| Potential impact | Caregiving is a large, specific need with a credible path to an Alexa+ add-on. Persona-driven demo. |
| Quality of idea | Covers the rules' own "creative" list: agentic multi-step workflow, cross-session context, purchasing, cards and carousels, MCP Apps, Agent Skills. Voice-specific insight: speech-to-text mangles drug names, so names are normalised through RxNorm approximate matching. |
| Friction-log bonus (up to 10%) | A real friction log, kept while building, in `docs/submission/FRICTION_LOG.md`. |

## Goals
1. A working MCP server (`packages/hearth-server`) that any MCP client can use, including Claude Code and Claude Desktop.
2. **Countertop** (`packages/countertop`): an open-source, browser-based "Alexa+-style" simulator. It is a real MCP
   client (initialize, tools/list, tools/call over Streamable HTTP) and an MCP Apps host, with voice in and out, an
   LLM agent loop and a protocol inspector. It is generic: point it at any MCP server URL. It also becomes the Open
   Source mini-challenge repo.
3. An Agent Skill (`skills/hearth-care/SKILL.md`) that Countertop loads at runtime as the assistant's operating
   instructions for Hearth.
4. A 3-minute demo the user can record from a script, plus all submission text (description, product feedback,
   friction log, feature requests).

## Non-goals
- Real pharmacy ordering or payments. The pharmacy is simulated and clearly labelled as such.
- Medical advice: no dosing changes and no diagnosis. Medication info is quoted from the FDA label and attributed.
- Hosting or deployment. The rules and FAQ say a locally runnable repo plus the video is enough.
- Real Alexa devices or the gated Alexa+ Category SDK, MCP Toolkit or Web Simulator (not available to participants).
- Accounts or auth flows beyond static bearer tokens for the demo household.

## Anti-goals (a failure even if it works)
- A thin Q&A wrapper around an API. That's the rules' own "obvious" example.
- Anything that sounds like it's giving medical instructions.
- Using Amazon branding as if this were an Amazon product.
- A demo that only works in a fragile, timing-dependent way. Use a controllable demo clock.
- API keys committed to the repo.

## Architecture

```
 Countertop (browser, Vite)                     hearth-server (Node, :8787/mcp)
 ┌──────────────────────────────┐   Streamable  ┌──────────────────────────────┐
 │ Device pane "June's Echo"    │◄────HTTP─────►│ McpServer (SDK v2)           │
 │ Device pane "Maya's phone"   │  (per-device  │  tools / resources / prompts │
 │  ├ voice (Web Speech API)    │   session +   │  elicitation, subscriptions  │
 │  ├ agent loop (LLM tools)    │   bearer id)  │  MCP Apps ui:// views        │
 │  ├ MCP Apps host (AppBridge) │               │ Care engine + JSON store     │
 │  └ protocol inspector        │               │ Demo clock + scheduler       │
 └──────────┬───────────────────┘               │ RxNorm / openFDA clients     │
            │ /llm proxy (key stays server-side)└──────────────────────────────┘
 Countertop node server ──► any OpenAI-compatible chat endpoint (Gemini, Groq, OpenAI, Anthropic compat, Ollama)
```

- **Identity:** each device sends `Authorization: Bearer <token>`. The server maps the token to a household member
  and role (`recipient` or `caregiver`). Tools are role-aware: the caregiver summary is available to the caregiver
  and the recipient alike, and a caregiver may log "I gave Mom her pill".
- **Storage:** a JSON file store (`data/hearth.json`) with seed data and a `reset`. No native dependencies, so
  judges can run it anywhere.
- **Demo clock:** server time can be set or advanced through `POST /demo/clock` when `HEARTH_DEMO=1`. The scheduler
  evaluates due and missed doses against the demo clock. Countertop shows a small "scenario" bar to drive it.

## MCP surface (initial; the builder may refine names)

Tools (all with `outputSchema` plus `structuredContent`, and annotations such as readOnly or destructive hints):
- `get_today` → today's dose schedule with status. **MCP App: Today card** (tap "Taken" → `app.callServerTool`).
- `log_dose(medication, status=taken|skipped, time?)` → resolves the medication by fuzzy name match.
- `add_medication(name, strength, times[], pills_on_hand, ...)` → **RxNorm approximate-term normalisation**.
- `medication_info(name, question?)` → openFDA label sections (purpose or indications, warnings, interactions,
  common side effects), returned as quoted excerpts with source.
- `refill_status()` → days of supply left per med, flags anything under 7 days.
- `order_refill(medication)` → builds a quote from the simulated pharmacy, then **elicitation** asks the user to
  confirm. If the client lacks elicitation, it returns a pending order plus `confirm_refill(order_id)`.
  **MCP App: checkout card.**
- `log_checkin(mood, note?)` → wellbeing journal. A "bad" mood or keywords like fall, dizzy or chest pain raise a caregiver alert.
- `care_summary(days=7)` → adherence %, missed doses, mood trend, open alerts, upcoming refills.
  **MCP App: weekly summary card** (chart).
- `notify_family(message)` → posts to the caregiver inbox.
- `get_alerts()` / `acknowledge_alert(id)`.

Resources: `hearth://household/profile`, `hearth://reminders/due` (subscribable: the server emits
`notifications/resources/updated` when a dose becomes due or an alert is raised), plus the `ui://hearth/*.html` app views.
Prompts: `morning_checkin`, `caregiver_briefing`.
Server `instructions`: voice-first style and safety rules.

## Countertop (simulator)
- Two side-by-side device frames (Echo-Show-like and phone-like). Each has its own MCP session, token and agent.
- Input: push-to-talk (Web Speech recognition) or typed text. Output: spoken via speechSynthesis, plus a short caption.
- Agent loop: system prompt = Agent Skill content + server `instructions`. Tools come from `tools/list` and are
  converted to OpenAI function schemas. Up to N tool rounds per turn.
- MCP Apps host: if a called tool declares `_meta.ui.resourceUri`, read the resource, render it in a sandboxed
  iframe and bridge it with `AppBridge` + `PostMessageTransport`. Views can call server tools.
- Elicitation: rendered as a spoken question plus Yes/No buttons. A spoken "yes" or "no" answers it.
- Subscriptions: when `hearth://reminders/due` updates, the device fetches it and speaks proactively
  ("June, it's 8 o'clock, time for your lisinopril").
- Inspector drawer: a live log of JSON-RPC messages (method, direction, timing).
- Config: MCP URL and tokens via the UI or `.env`. LLM endpoint, model and key in the Countertop server `.env` only.

## Constraints
- Windows dev machine, Node 20, no Python, no Docker. `gh` is not installed.
- Stack: TypeScript, npm workspaces, `@modelcontextprotocol/server|client|node` v2, `@modelcontextprotocol/ext-apps` v2,
  zod v4, Vite, vitest.
- Must be runnable by judges with `npm install && npm run dev` plus an LLM key. The MCP server itself needs no key.
- License: MIT. The repo is public on GitHub.

## Decisions made by Claude (the user delegated everything)
- Alexa+ track; the caregiving concept; the name "Hearth"; the simulator "Countertop" as the Open Source entry.
- The LLM sits behind an OpenAI-compatible proxy, recommended default Gemini free tier. Personas June and Maya Alvarez are fictional.
- Elicitation for purchase confirmation, with a two-step fallback.

## Left to the builder
File layout inside packages, exact tool names, visual styling, and test granularity.
