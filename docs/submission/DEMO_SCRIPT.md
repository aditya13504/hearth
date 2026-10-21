# Demo video script (target 2:50, hard limit 3:00)

The rules: under 3 minutes, public on YouTube or Vimeo, in English, no copyrighted music, and it must show the
project working. The judges' tips: lead with the problem, show the solution working, and make the required
technology (the MCP server) impossible to miss.

## Before you record (10 minutes)

1. Close other apps and turn on *Do Not Disturb*.
2. In a terminal, from the repo folder: `npm run dev`. Wait for both "MCP server on…" and "countertop …".
3. Open **Microsoft Edge** at `http://localhost:5173`, maximise it, and press **F11** for full screen. The page
   scrolls normally. At 1920×1080 the top band, both devices and the story rail are all on screen. On a smaller
   laptop screen, scroll down a little so the devices fill the view.
4. In the top bar, click **Reset demo**. The "June's day" clock goes back to *7:55 AM*, and the story rail goes back
   to step 1.
5. Make sure the voice is **on**: the top-bar button should read *Voice on*. Turn the volume up, because the
   assistant's spoken replies are part of the video.
6. Do one practice run of the whole story, then click **Reset demo** again before the real take.
7. Recorder: press **Win + Alt + R** (Xbox Game Bar) to record the Edge window with system audio, or use OBS. Record
   your narration live with a headset mic, or add it afterwards as a voice-over.

**How to drive the demo:** the **Run the story** panel on the right is the whole script. Click the yellow
**Play step N** button and it plays the next step on the right device: it moves the clock or says the line for you.
Each step ticks itself off when the assistant has finished. You can also click a step's own play pill to repeat it,
use the suggestion chips under each device, or press the mic button and speak.

**Tips**
- Wait for each spoken reply to finish before playing the next step.
- At step 5, a **confirmation sheet** slides up on June's display. Click **Yes, go ahead**, or say "yes" with the mic.
- If a reply is slow or odd, keep recording and replay just that step. Cut the dead time when editing.
- Speed up any waiting to 1.5–2× in the editor; the free Clipchamp app on Windows is enough.
- If Groq's free tier is busy, the device says "I'm a little busy right now". Wait about 20 seconds and replay the
  step. Gemini's free quota resets daily, so record after it has reset if you can.

## Shot list and narration

| Time | On screen (what you do) | Narration (what you say) |
|---|---|---|
| 0:00–0:15 | Top of the page: the "June's day" band with the sun on its arc. Hover over June's display, then Maya's phone. | "Fifty-three million Americans care for a family member. Most of that care is small and remote: did Mom take her pills, is she running low, is she okay? Hearth brings that care circle to Alexa+." |
| 0:15–0:30 | Point at the green **Connected** badges, then scroll briefly to **What the devices and the server are saying** (the MCP log), then back up. | "Hearth is a self-hosted MCP server, spec 2025-11-25 over Streamable HTTP. June's kitchen display and her daughter Maya's phone are two separate MCP sessions on the same server. This is Countertop, our open-source Alexa+ simulator, and every message in this log is real MCP traffic." |
| 0:30–0:50 | **Play step 1** (*Morning medicine time*). The sun moves to 8 AM, there's a chime, and June's display speaks up. | "At eight, the server pushes a resource update and June's display speaks up on its own. It always says what each pill looks like." |
| 0:50–1:05 | **Play step 2**, then **Play step 3**. | "She logs it by voice. If she forgets and asks again, Hearth tells her not to take another, and the server itself refuses to record a second dose of the same pill." |
| 1:05–1:20 | **Play step 4** (*What is this pill for?*). | "Medication questions are answered from the official FDA label through openFDA, attributed and never as dosing advice." |
| 1:20–1:45 | **Play step 5** (*Running low*). When the sheet slides up, click **Yes, go ahead**. The receipt card appears, and Maya's phone gets a notice. | "Refills use MCP elicitation: the server asks June to confirm the price and delivery on her own device before anything is ordered. That receipt is an interactive MCP Apps card, and Maya hears about the order at once." |
| 1:45–2:10 | **Play step 6** (*June mentions a fall*). Maya's phone glows red, shows an alert and speaks. | "When June mentions a fall, Hearth logs it and alerts Maya right away. Her phone speaks up without being asked." |
| 2:10–2:20 | **Play step 7** (*Maya replies*). June's display reads the message out. | "Maya can reply by voice, and June hears it in her kitchen." |
| 2:20–2:40 | **Play step 8** (*Maya checks the week*). Scroll the summary card on her phone a little. | "And when Maya asks how Mom's doing, she gets the week: adherence, missed doses, mood from June's check-ins, and refills to act on, from context shared across both people and both devices." |
| 2:40–2:55 | Scroll down to the MCP log. Click one row (**elicitation/create** or **notifications/resources/updated**) to show its JSON. | "Under the hood: 12 tools with output schemas, subscribable resources, prompts, elicitation, three MCP Apps, an Agent Skill, NIH RxNorm for misheard drug names, and 49 automated tests. Countertop is MIT-licensed for any MCP developer." |
| 2:55–3:00 | Scroll back to the top. | "Hearth. Care from anywhere." |

## Optional extra (only if you're under time)

- After a reset, click **9:05 AM** in "June's day" to show the **missed-dose alert** on Maya's phone ("June hasn't
  taken her 8 AM pills yet…").

## After recording

1. Trim the video to under 3:00.
2. Upload to YouTube as **Public**, titled "Hearth: an Alexa+ care companion (MCP) | Build, Ship, Shape 2026".
3. Paste the link into the Devpost form.
