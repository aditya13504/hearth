# Friction log

Kept while building Hearth (Alexa+ track) between Oct 21 and Oct 23, 2026. Severity: **High** = blocked or forced a
redesign, **Medium** = cost an hour or more, **Low** = annoyance.

---

### 1. Getting an Alexa+ test surface for a self-hosted MCP server
- **Task:** see my MCP server working "in Alexa+".
- **Steps:**
  1. Read the add-on docs and setup guides for the Category SDK, MCP Toolkit, CLI and Web Simulator.
  2. Looked for a way to sign up.
  3. Found the hackathon FAQ.
- **Expected vs actual:**
  - **Expected:** a public simulator or developer console where I could register an MCP URL.
  - **Actual:** all of these tools are partner-only. Several setup pages don't say so.
- **Severity:** High.
- **Workaround:** built Countertop, an Alexa+-style simulator with its own MCP client, MCP Apps host, elicitation and
  notifications. It took about 40% of the build time.
- **Suggestion:**
  - Publish a public "Add-on Sandbox": paste an MCP URL and token, then talk to it in a browser Alexa+.
  - Until then, put "partner-only" at the top of every gated page.

### 2. How does Alexa+ tell my server who is speaking?
- **Task:** make tools role-aware, so a parent and a caregiver get different behaviour.
- **Steps:** searched the add-on docs for account linking, speaker identity, and OAuth claims for MCP.
- **Expected vs actual:**
  - **Expected:** a documented claim or header carrying the account and the recognised speaker.
  - **Actual:** nothing public.
- **Severity:** Medium.
- **Workaround:** one bearer token per device, and one server instance per session bound to the person.
- **Suggestion:** document identity propagation, including the household, the recognised speaker and their
  relationship. Multi-person add-ons (care, family, roommates) depend on it.

### 3. Which MCP client features will Alexa+ support?
- **Task:** decide whether to use elicitation, resource subscriptions and MCP Apps.
- **Expected vs actual:**
  - **Expected:** a client-capability matrix for Alexa+.
  - **Actual:** none, so I designed for spec 2025-11-25 and added fallbacks, for example a two-step
    `confirm_refill` if elicitation isn't available.
- **Severity:** Medium.
- **Suggestion:** publish an Alexa+ MCP client support matrix, covering elicitation (voice and screen), subscriptions
  and proactive delivery, MCP Apps on Echo Show, and prompts.

### 4. SDK v2: protocol era vs the 2025-11-25 requirement
- **Task:** build a 2025-11-25 server with the current TypeScript SDK.
- **Steps:**
  1. Installed `@modelcontextprotocol/server` 2.3.1. Its README says it implements the 2026-07-28 spec.
  2. The docs default to the stateless `createMcpHandler`, where elicitation uses `inputRequired`.
  3. Checked `LATEST_PROTOCOL_VERSION` in the dist output: it is `2025-11-25`.
- **Expected vs actual:**
  - **Expected:** one example of a 2025-11-25 stateful server with elicitation and notifications.
  - **Actual:** the answer was spread across 4 doc pages and the type definitions.
- **Severity:** Medium.
- **Workaround:** a hand-wired `NodeStreamableHTTPServerTransport` with a session map, and
  `isInitializeRequest` for routing.
- **Suggestion:** add a "Serving 2025-11-25 clients (sessions + elicitation + notifications)" recipe, and make the
  README state the default negotiated version.

### 5. ext-apps v2 needs the split SDK packages
- **Task:** add MCP Apps to the server.
- **Expected vs actual:** I expected it to work with `@modelcontextprotocol/sdk`. Instead `ext-apps/server`
  imports `@modelcontextprotocol/server`, the v2 split packages.
- **Severity:** Low.
- **Suggestion:** state the SDK version pairing at the top of the ext-apps README.

### 6. MCP Apps host handshake race
- **Task:** render a `ui://` view in Countertop.
- **Steps:**
  1. Created the iframe and set `srcdoc`.
  2. Awaited the `load` event, then connected the `AppBridge`.
- **Expected vs actual:**
  - **Expected:** the view initialises.
  - **Actual:** the view's `ui/initialize` went out before the bridge was listening, so sometimes nothing rendered.
- **Severity:** Medium.
- **Workaround:** connect `PostMessageTransport` to the iframe's `contentWindow` first, then set `srcdoc`. The
  WindowProxy is stable across navigation.
- **Suggestion:** call out this ordering in the AppBridge docs and examples.

### 7. 60-second default timeout on human confirmations
- **Task:** confirm a refill purchase by voice.
- **Expected vs actual:**
  - **Expected:** the confirmation waits for the person.
  - **Actual:** `elicitInput` timed out after 60 seconds, and so did the client's `callTool`.
- **Severity:** Medium. This is a real UX bug for older users.
- **Workaround:** `{ timeout: 5 * 60_000 }` on both sides.
- **Suggestion:** give elicitation a longer default timeout and document the option on the elicitation page. Alexa+
  guidance on confirmation timing would help too.

### 8. Voice confirmations can be falsely satisfied
- **Task:** answer an elicitation by speech.
- **Expected vs actual:**
  - **Expected:** only a deliberate "yes" places the order.
  - **Actual:** my first matcher accepted *"I fell getting out of my chair but I'm okay"* because of "okay". The
    order was placed and the fall was never logged.
- **Severity:** High (a safety issue, caught in testing).
- **Workaround:** only short, unambiguous yes or no answers count. Anything else cancels the confirmation and is
  handled as a new request.
- **Suggestion:** publish Alexa+ voice-confirmation guidance for add-ons that use elicitation: how yes/no is
  detected and what happens to off-topic replies.

### 9. Models claiming actions they didn't take
- **Task:** a fall report must reach the family.
- **Expected vs actual:**
  - **Expected:** the model calls `log_checkin`.
  - **Actual:** a fast model replied "I've noted that for the family" without calling any tool.
- **Severity:** High.
- **Workaround:**
  - stronger tool descriptions ("the only way the family finds out")
  - a client guardrail that holds back replies that claim an action when no tool ran, and sends the model back
    to act
- **Suggestion:** Alexa+ could expose to add-on developers when the assistant says something about an add-on
  without having called it.

### 10. Free-tier LLM limits while building a voice demo
- **Task:** run the simulator's assistant on free LLM tiers.
- **Expected vs actual:**
  - Gemini's free tier is 20 requests per model per day; each spoken turn uses 2–4.
  - Groq is 8,000 tokens per minute per model.
  - Gemini flash-lite rejects `reasoning_effort: "none"` with a bare "invalid argument".
  - Switching providers mid-conversation breaks Gemini 3 thought signatures.
- **Severity:** Medium.
- **Workaround:**
  - a route chain across models and providers with cooldowns
  - "minimal" effort for the lite model
  - the documented placeholder thought signature
  - trimmed tool results and history
- **Suggestion:** no Amazon action needed. Noted because hackathon participants without AWS credits run into it.

### 11. Public health APIs and spoken input
- **Task:** turn a heard drug name into a real ingredient and FDA label.
- **Expected vs actual:**
  - RxNorm mapped "met for men" to Actoplus Met.
  - openFDA returned combination products first.
- **Severity:** Low.
- **Workaround:**
  - query a joined-up spelling of the words as well
  - rank RxNorm candidates by spelling distance
  - filter openFDA labels to single-ingredient ones and clean section text for speech

### 12. AWS credits ran out before I joined
- **Task:** enter the AWS Builder mini challenge.
- **Expected vs actual:** the credit form was closed on Oct 7, and I had no billed AWS account.
- **Severity:** Low for this project; it reduced which challenges I could enter.
- **Suggestion:** keep a small credit pool for late joiners, or allow Kiro-only entries to be stated up front.
