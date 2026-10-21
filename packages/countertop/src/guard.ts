/**
 * Guardrail: a voice assistant must not claim (or promise) an action it never took. If a turn ends with
 * "I've told Maya…" or "I'm now getting her summary…" but no tool ran, the reply is held back and the
 * model is sent back to actually do it.
 */

/** "I've noted…", "I logged…", "I let Maya know…" */
const CLAIMED =
  /\bI(?:'ve| have)?\s+(?:just\s+|already\s+)?(?:noted|logged|recorded|saved|told|let \w+ know|alerted|notified|ordered|placed|sent|messaged|added|marked|checked you in)\b/i;

/** "I'm now getting…", "I'll pull up…", "Let me check…", "one moment while I…" */
const ANNOUNCED =
  /\b(?:I'?m (?:now |just )?(?:getting|pulling|checking|fetching|looking|bringing|loading|grabbing|sending|ordering|logging)|I(?:'ll| will) (?:now |just )?(?:get|pull|check|fetch|look|bring|load|grab|send|order|log|tell|let)|let me (?!know\b)\w+|one moment while I)\b/i;

/** "…which you'll see on screen" without any card-producing tool call. */
const MENTIONS_SCREEN = /\bon (?:the |your )?screen\b/i;

export function unbackedClaim(reply: string, toolCallsThisTurn: number): boolean {
  if (toolCallsThisTurn > 0) return false;
  return CLAIMED.test(reply) || ANNOUNCED.test(reply) || MENTIONS_SCREEN.test(reply);
}

/**
 * Models sometimes narrate instead of speaking: `I'd announce: "Good morning, June…"`.
 * Keep only the words meant for the listener.
 */
export function speakable(reply: string): string {
  const m = reply.match(/^\s*(?:I'?d|I would|I will|I'll)\s+(?:say|announce|tell \w+|respond|reply)[^:"“]*:\s*["“](.+)["”]\s*$/is);
  return collapseRepeat((m ? m[1] : reply).trim());
}

/** Some providers occasionally return the whole reply twice ("Sent.Sent."); say it once. */
export function collapseRepeat(text: string): string {
  const compact = text.replace(/\s+/g, '');
  if (compact.length < 8 || compact.length % 2) return text;
  const half = compact.slice(0, compact.length / 2);
  if (half !== compact.slice(compact.length / 2)) return text;
  // Walk the original text until the first half's non-space characters are used up.
  let seen = 0;
  for (let i = 0; i < text.length; i++) {
    if (!/\s/.test(text[i])) seen++;
    if (seen === half.length) return text.slice(0, i + 1).trim();
  }
  return text;
}
