# Feature requests

1. **Public Alexa+ Add-on Sandbox for MCP servers.** *Priority: Critical.*
   - **What:** a web console where any developer pastes an MCP URL and auth, then talks to a real Alexa+ (voice and
     screen) against it.
   - **Why it matters:** the Category SDK, MCP Toolkit and Web Simulator are partner-only. Every outside developer
     has to build their own simulator (I built Countertop). Without one, there's no way to check voice UX,
     confirmations or cards on Echo Show.

2. **Documented speaker identity and household context for add-ons.** *Priority: Critical.*
   - **What:** a standard way (OAuth claims or a request `_meta` field) for Alexa+ to pass the account, the household
     and the recognised speaker to an MCP server.
   - **Why it matters:** multi-person add-ons for care, family logistics and shared homes need to know who is
     speaking. Hearth behaves differently for a parent and for a caregiver.

3. **Alexa+ MCP client capability matrix.** *Priority: Important.*
   - **What:** a table of which 2025-11-25 features Alexa+ supports, and on which devices: elicitation by voice and
     screen, `resources/subscribe` and proactive delivery, MCP Apps on Echo Show and Fire TV, prompts, and
     `instructions`.
   - **Why it matters:** these decide how an add-on is designed: push versus pull, and on-device confirmation
     versus a two-step tool.

4. **Proactive notifications from add-ons.** *Priority: Important.*
   - **What:** let an add-on's resource updates or notifications become Alexa announcements, with user-controlled
     quiet hours and urgency levels.
   - **Why it matters:** medication reminders and caregiver alerts must arrive without the user asking first.

5. **Voice-confirmation guidance and a longer elicitation timeout.** *Priority: Important.*
   - **What:** document how Alexa+ resolves spoken yes or no for elicitation and what happens to off-topic replies.
     Recommend timeouts suited to older users.
   - **Why it matters:** purchases and other irreversible actions by voice need predictable confirmation behaviour.

6. **Linked caregiver accounts across households.** *Priority: Nice-to-have.*
   - **What:** a first-class "care circle" relationship, so an adult child's Alexa (phone or Echo) can use an add-on
     on behalf of a parent's household, with consent.
   - **Why it matters:** this is the core of Hearth, and it is what Alexa Together used to provide.

7. **MCP Apps rendering on Fire TV.** *Priority: Nice-to-have.*
   - **What:** let the same `ui://` cards appear on a Fire TV as a "family dashboard".
   - **Why it matters:** families gather in the living room, and one MCP surface could cover the kitchen, the phone
     and the TV.
