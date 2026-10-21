# Devpost submission: copy into the form

**Project name:** Hearth

**Tagline (elevator pitch, ≤ 200 chars):**
An Alexa+ care companion that keeps families in the loop: medicine reminders, refills and daily check-ins, shared
between Mom's kitchen and her daughter's phone over MCP.

**Tracks:** Alexa+ (primary) · Mini challenge: Open Source

**Built with:** typescript, node.js, model-context-protocol, mcp-apps, mcp-typescript-sdk, express, vite, vitest,
web-speech-api, openfda, rxnorm, groq, gemini, agent-skills, claude-code

**Links:**
- Code: https://github.com/aditya13504/hearth (MIT)
- Open Source mini challenge (Countertop): https://github.com/aditya13504/countertop (MIT)
- Demo video: *(paste the YouTube link)*

---

## Inspiration

Millions of older adults live alone while their children live and work in other cities. The daily questions are
small but constant:
- Did Mom take her pills?
- Is she running out?
- How has she been feeling?

About 53 million Americans are unpaid family caregivers (AARP, 2020). When Amazon retired Alexa Together in 2024,
the one mainstream voice product built for this went away.

Alexa+ is already in the kitchen, it is voice-first (which suits many older adults), and add-ons are now built on
the open Model Context Protocol. So I built the care circle as an Alexa+ add-on.

## What it does

Hearth is a self-hosted **MCP server** used by two kinds of people at once, through their own devices:

**June (79), on her kitchen display:**
- At 8 AM her display speaks up on its own: *"Good morning June, time for your Lisinopril, the small pink round one,
  and your Metformin…"*
- *"I took my morning pills"* logs every due dose. *"Did I take the pink one? I might take another"* is answered with
  *"You already took it at 8:04, don't take another."* Double-dose protection is enforced by the server.
- *"What's the white oval one for?"* is answered **from the FDA drug label**, attributed, and never as dosing advice.
- *"I'm almost out of metformin"* brings up the price and delivery on screen, and the order goes through only after
  she says **yes**. The pharmacy is simulated.
- *"I fell getting out of my chair this morning, but I'm okay"* is logged, and her daughter is alerted at once.

**Maya (her daughter), on her phone:**
- Her phone announces things as they happen: a dose still not taken an hour later, a fall, a refill that was ordered.
- *"How's Mom doing this week?"* returns adherence (for example 88%), the missed doses, a mood trend from June's
  check-ins, and refills running low, on a summary card she can act on.
- *"Let Mom know I'll call her at 6"* is read aloud on June's display.

Because both people talk to **the same MCP server**, Hearth keeps context across sessions, devices and people. That
cross-person memory is what makes it a care product rather than a pill timer.

## How I built it

- **MCP server (TypeScript, MCP TS SDK v2).** Stateful **Streamable HTTP** sessions that negotiate **protocol
  2025-11-25**, using a broad slice of the spec:
  - **12 tools** with output schemas, structured content and annotations
  - **resources**, including a **subscribable inbox**: the server sends `notifications/resources/updated` to push
    reminders and alerts proactively
  - **prompts** and server **instructions**
  - **elicitation** to confirm every purchase, with a two-step fallback for clients without it
  - **3 MCP Apps** (`ui://` views): today's medicines with "I took it" buttons that call server tools directly, a
    weekly summary with charts, and a refill receipt
- **Identity.** Each device's bearer token identifies the person (Alexa+ would supply the recognised speaker). The
  server binds one MCP server instance per session to that person and role.
- **Real data where it matters.**
  - **NIH RxNorm** normalises drug names as speech recognition hears them: "met for men" becomes metformin, and
    "lisinoprl" becomes lisinopril.
  - **openFDA** supplies label excerpts. It prefers single-ingredient labels and skips dosing sections on purpose.
  - Responses are cached on disk, so a slow API never leaves someone waiting.
- **Care engine.**
  - Dose states (due, taken, missed) with a configurable missed-dose escalation.
  - Adherence and supply forecasting.
  - Red-flag detection in check-ins (falls, chest pain, dizziness, breathing trouble, confusion).
  - A per-person inbox, and a demo clock so the story can be shown on cue.
- **Agent Skill.** `skills/hearth-care/SKILL.md` teaches any agent the workflows, voice rules ("say what the pill
  looks like") and safety rules. The simulator loads it at runtime.
- **Countertop, the simulator.** The Alexa+ developer tools are private preview, so I built an open-source
  Alexa+-style simulator:
  - a browser **MCP client** (initialize, tools/list, tools/call over Streamable HTTP)
  - an **MCP Apps host**
  - voice in and out, on-device elicitation, and proactive notifications
  - a live **protocol inspector**
  - any OpenAI-compatible LLM, with failover across free tiers
- **Production mode.** Beyond the demo, a family can run Hearth for real:
  - a setup command creates their household with random device tokens, storing only their hashes
  - medicines are added by voice and checked against RxNorm
  - it uses the real clock, keeps data persistent and saves atomically, and never resets data
  - browser access is limited to trusted origins
- **Tests.** 49 automated tests, including end-to-end protocol tests with a real MCP client and tests for the guardrail against claimed actions:
  - version negotiation and auth
  - double-dose protection across two people
  - push notifications
  - elicitation, both accept and decline, and the fallback path

## Challenges I ran into

- **No access to the real Alexa+ tooling.** The Category SDK, MCP Toolkit and Web Simulator are partner-only, so I
  had to build a faithful simulator first. That simulator became the Open Source entry.
- **Voice plus purchases is a safety problem.** My first voice-confirmation parser took *"I fell, but I'm okay"* as
  "okay" and approved a pending order. Now only a short, unambiguous yes or no can confirm; anything else cancels
  and is handled as a new request.
- **Models that claim actions they didn't take.** One model told June "I've let Maya know" without calling the tool.
  Countertop now catches replies that claim an action when no tool ran, and sends the model back to do it. The
  server's tool descriptions also say plainly that `log_checkin` is the only way the family finds out.
- **Timeouts made for machines, not people.** Elicitation requests used the SDK's 60-second default. An older adult
  reading a price may take longer, so purchase confirmations now wait up to 5 minutes.
- **Free-tier LLM limits.** Gemini's free tier allows 20 requests per model per day, and Groq allows 8,000 tokens
  per minute. I built a route chain that rotates models on 429s. It also re-attaches Gemini thought signatures when
  a conversation moves between providers, and trims prompts to fit.

## Accomplishments I'm proud of

- A complete, coherent product loop between two people on two devices, driven entirely by MCP: request/response,
  server push, elicitation and UI apps.
- Safety designed in: server-side double-dose protection, attributed FDA facts with no dosing advice, explicit
  purchase confirmation, and red-flag escalation.
- A reusable, generic open-source tool (Countertop) that any Alexa+ or MCP developer can use today.

## What I learned

- Writing tools for a voice-first add-on is a different craft from writing them for a chat app. Each tool's text
  output has to be speakable, include what the pill *looks like*, and be impossible to misread ("DONE: the order is
  placed — do not ask again").
- The 2025-11-25 primitives that matter most for voice are elicitation and resource subscriptions, because they let
  the add-on ask and notify, not just answer.

## What's next for Hearth

- Real account linking and speaker recognition from Alexa+ instead of device tokens.
- A pharmacy integration, with prescriptions verified by the pharmacist.
- Routines: adjusting the reminder style when adherence slips, and a weekly digest pushed to caregivers.
- Fire TV: a "family dashboard" view of the same MCP Apps cards on the living-room TV.
- A pilot with family caregivers to tune the missed-dose escalation window and the tone of reminders.

---

## Product feedback (required field)

See [PRODUCT_FEEDBACK.md](PRODUCT_FEEDBACK.md) and paste it.

## Open Source mini challenge fields

- **Contribution URL:** https://github.com/aditya13504/countertop
- **Project repository URL:** https://github.com/aditya13504/hearth
- **GitHub username:** aditya13504
- **What I did, how it works, why it matters:**
  - **What:** I built **Countertop**, an MIT-licensed, browser-based voice-assistant simulator for testing any MCP
    server the way Alexa+ users will experience it.
  - **How:**
    - It is a real MCP client over Streamable HTTP (protocol 2025-11-25), built on the official TypeScript SDK v2.
    - It simulates several devices with separate sessions and identities.
    - It hosts MCP Apps views through the official AppBridge.
    - It renders elicitation as an on-device yes/no that can be answered by voice.
    - It subscribes to resources so devices can announce updates proactively.
    - It loads Agent Skills as the assistant's instructions.
    - It shows every JSON-RPC message in an inspector.
    - It works with any OpenAI-compatible LLM, with free-tier failover.
  - **Why:** the Alexa+ developer tools are partner-only today, and generic MCP inspectors don't show whether a
    server works *by voice*. Countertop gives every MCP developer that test loop locally, for free.

## Friction log (optional, up to +10%)

See [FRICTION_LOG.md](FRICTION_LOG.md).

## Feature requests (optional)

See [FEATURE_REQUESTS.md](FEATURE_REQUESTS.md).
