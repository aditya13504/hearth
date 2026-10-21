# Demo video script (target 2:50, hard limit 3:00)

The rules: under 3 minutes, public on YouTube or Vimeo, in English, no copyrighted music, and it must show the
project working. The judges' tips: lead with the problem, show the solution working, and make the required
technology (the MCP server) impossible to miss.

## Before you record (10 minutes)

1. Close other apps and turn on *Do Not Disturb*.
2. In a terminal, from the repo folder: `npm run dev`. Wait for both "MCP server on…" and "countertop …".
3. Open **Microsoft Edge** at `http://localhost:5173`, maximise it, and press **F11** for full screen.
4. If anything is cut off, zoom with **Ctrl + -** to 90% or 80% until both devices, the suggestion chips and the
   *MCP traffic* panel all fit on screen.
5. Click **Reset demo data**, then **7:55 AM**.
6. Make sure the voice is **on**: the header button should read *Mute voice*. Turn the volume up. The assistant's
   spoken replies are part of the video.
7. Do one practice run of the whole script below, then **Reset demo data** and **7:55 AM** again before the real take.
8. Recorder: press **Win + Alt + R** (Xbox Game Bar) to record the Edge window with system audio, or use OBS. Record
   your narration live with a headset mic, or add it afterwards as a voice-over.

**Tips**
- Use the **suggestion chips** under each device instead of typing. They're reliable and look clean. You can also
  click the mic button and speak, in which case Edge transcribes you live.
- Wait for each spoken reply to finish before clicking the next chip.
- If a reply is slow or odd, keep recording and redo just that step. Cut the dead time when editing.
- Speed up any waiting to 1.5–2× in the editor; the free Clipchamp app on Windows is enough.

## Shot list and narration

| Time | On screen (what you do) | Narration (what you say) |
|---|---|---|
| 0:00–0:15 | The app at full screen, idle (*7:55 AM*). Slowly hover over June's display, then Maya's phone. | "Fifty-three million Americans care for a family member. Most of that care is small and remote: did Mom take her pills, is she running low, is she okay? Hearth brings that care circle to Alexa+." |
| 0:15–0:30 | Hover over the **MCP traffic** panel, then the green status line above each device ("MCP 2025-11-25 · hearth · 12 tools"). | "Hearth is a self-hosted MCP server, spec 2025-11-25 over Streamable HTTP. June's kitchen display and her daughter Maya's phone are two separate MCP sessions on the same server. This is Countertop, our open-source Alexa+ simulator. Every message you see on the right is real MCP traffic." |
| 0:30–0:50 | Click **8:00 AM** in the demo clock bar. Wait for the chime and the spoken reminder on June's display. | "At eight, the server pushes a resource update and June's display speaks up on its own. It always says what each pill looks like." |
| 0:50–1:05 | June: click **"I just took my blood pressure pill"**. Wait. Then type or say: **"Did I take the pink one? I might take another"**. | "She logs it by voice. If she forgets and asks again, Hearth tells her not to take another, and the server itself refuses to record a second dose of the same pill." |
| 1:05–1:20 | June: click **"What is the white oval one for?"** | "Medication questions are answered from the official FDA label through openFDA, attributed and never as dosing advice." |
| 1:20–1:45 | June: click **"I'm almost out of metformin, can you order more?"** When the **Confirm** card appears, say or type **"yes"** (or click Yes). The receipt card appears. | "Refills use MCP elicitation: the server asks June to confirm the price and delivery on her device before anything is ordered. That's an interactive MCP Apps card, and Maya is notified at once." |
| 1:45–2:10 | June: type or say **"I fell getting out of my chair this morning but I'm okay"**. Watch Maya's phone chime and announce it. | "When June mentions a fall, Hearth logs it and alerts Maya right away. Her phone speaks up without being asked." |
| 2:10–2:20 | Maya: click **"Let Mom know I'll call her at 6"**. June's display reads it out. | "Maya can reply by voice, and June hears it in her kitchen." |
| 2:20–2:40 | Maya: click **"How's Mom doing this week?"** Scroll the summary card on her phone a little. | "And when Maya asks how Mom's doing, she gets the week: adherence, missed doses, mood from June's check-ins, and refills to act on, all from shared context across both people and both devices." |
| 2:40–2:55 | Expand one row in the MCP traffic panel (click **elicitation/create** or **notifications/resources/updated**) to show the JSON. | "Under the hood: 12 tools with output schemas, subscribable resources, prompts, elicitation, three MCP Apps, an Agent Skill, NIH RxNorm for misheard drug names, and 40 automated tests. Countertop is MIT-licensed for any MCP developer." |
| 2:55–3:00 | Back to the full view. | "Hearth. Care from anywhere." |

## Optional extra (only if you're under time)

- Click **9:05 AM** right after a reset to show the **missed-dose alert** on Maya's phone ("June hasn't taken her
  8 AM pills yet…").

## After recording

1. Trim the video to under 3:00.
2. Upload to YouTube as **Public**, titled "Hearth: an Alexa+ care companion (MCP) | Build, Ship, Shape 2026".
3. Paste the link into the Devpost form.
