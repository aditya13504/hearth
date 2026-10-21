import { describe, expect, it } from 'vitest';
import { unbackedClaim } from '../src/guard';

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
