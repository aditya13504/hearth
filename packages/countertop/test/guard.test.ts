import { describe, expect, it } from 'vitest';
import { speakable, unbackedClaim } from '../src/guard';

describe('unbackedClaim', () => {
  it.each([
    ["June reported a fall. I'm now getting her care summary for you, which you'll see on screen.", 0],
    ["I've noted your mention of a fall for the family, but please call 911.", 0],
    ['Let me check her schedule.', 0],
    ["I'll let Maya know right away.", 0],
  ])('holds back "%s" when no tool ran', (reply, calls) => {
    expect(unbackedClaim(reply, calls)).toBe(true);
  });

  it.each([
    ['Your message has been sent to Mom. Let me know if you need anything else.', 0],
    ["You already took the pink one at 8 AM, so you don't need to take another.", 0],
    ["Good morning, June! It's time for your Lisinopril. Would you like me to mark them as taken once you're done?", 0],
    ["I've logged your check-in, and your family has been alerted.", 2],
    ['The summary is on the screen.', 1],
  ])('lets "%s" through', (reply, calls) => {
    expect(unbackedClaim(reply, calls)).toBe(false);
  });
});

describe('speakable', () => {
  it('strips narration around the words to say', () => {
    expect(speakable(`I'd announce the reminder: "Good morning, June! It's 8 AM."`)).toBe("Good morning, June! It's 8 AM.");
    expect(speakable('I would say: “Time for your Metformin.”')).toBe('Time for your Metformin.');
  });
  it('leaves normal replies alone', () => {
    expect(speakable('Good morning, June! Time for your Lisinopril.')).toBe('Good morning, June! Time for your Lisinopril.');
  });
});

describe('speakable collapses an exactly repeated reply', () => {
  it.each([
    ['Message sent to Mom.Message sent to Mom.', 'Message sent to Mom.'],
    ['According to the FDA label, Metformin helps control blood sugar. According to the FDA label, Metformin helps control blood sugar.', 'According to the FDA label, Metformin helps control blood sugar.'],
  ])('"%s"', (input, expected) => {
    expect(speakable(input)).toBe(expected);
  });
  it('keeps replies that merely repeat a word', () => {
    expect(speakable('Yes, yes, I logged it.')).toBe('Yes, yes, I logged it.');
  });
});
