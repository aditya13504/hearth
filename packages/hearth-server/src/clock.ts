/**
 * A controllable clock. In demo mode the presenter can jump to "8:00 AM" or fast-forward,
 * so reminders and missed-dose escalations happen on cue instead of on wall-clock time.
 */
export class Clock {
  private offsetMs = 0;

  now(): Date {
    return new Date(Date.now() + this.offsetMs);
  }

  /** Jump to a specific instant; time keeps flowing from there. */
  set(to: Date): void {
    this.offsetMs = to.getTime() - Date.now();
  }

  /** Jump to HH:MM today (local time), keeping the current date. */
  setTimeOfDay(hhmm: string): void {
    const [h, m] = hhmm.split(':').map(Number);
    const target = this.now();
    target.setHours(h, m, 0, 0);
    this.set(target);
  }

  advance(minutes: number): void {
    this.offsetMs += minutes * 60_000;
  }

  reset(): void {
    this.offsetMs = 0;
  }
}

export const pad2 = (n: number) => String(n).padStart(2, '0');

/** YYYY-MM-DD in local time. */
export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Local Date for a YYYY-MM-DD day at HH:MM. */
export function atSlot(day: string, hhmm: string): Date {
  const [y, mo, d] = day.split('-').map(Number);
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(y, mo - 1, d, h, m, 0, 0);
}

export function addDays(day: string, delta: number): string {
  const d = atSlot(day, '12:00');
  d.setDate(d.getDate() + delta);
  return dateKey(d);
}

/** "08:00" -> "8:00 AM" — what a voice assistant would actually say. */
export function speakTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12} ${suffix}` : `${h12}:${pad2(m)} ${suffix}`;
}
