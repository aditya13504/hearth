/** Browser speech in and out (Web Speech API). Works in Edge and Chrome; text input is always available. */

let preferred: string[] = [];
let chosen: SpeechSynthesisVoice | null = null;

export function configureVoice(names: string[] = []) {
  preferred = names;
  chosen = null;
}

function pickVoice(): SpeechSynthesisVoice | null {
  if (chosen) return chosen;
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith('en'));
  for (const name of preferred) {
    const v = voices.find((x) => x.name.includes(name) && x.lang === 'en-US') ?? voices.find((x) => x.name.includes(name));
    if (v) return (chosen = v);
  }
  return (chosen = voices.find((v) => v.lang === 'en-US') ?? voices[0] ?? null);
}
if (typeof speechSynthesis !== 'undefined') speechSynthesis.onvoiceschanged = () => (chosen = null);

let muted = false;
export const setMuted = (m: boolean) => {
  muted = m;
  if (m) speechSynthesis.cancel();
};
export const isMuted = () => muted;

/** Speak text; resolves when finished (or immediately when muted/unsupported). */
export function speak(text: string): Promise<void> {
  if (muted || typeof speechSynthesis === 'undefined' || !text.trim()) return Promise.resolve();
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice();
    if (v) u.voice = v;
    u.rate = 1.0;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    speechSynthesis.speak(u);
    // Some engines never fire onend for long text; don't block the UI forever.
    setTimeout(resolve, Math.min(30_000, 2_000 + text.length * 90));
  });
}

type Recognition = any;
const RecognitionCtor: any = (globalThis as any).SpeechRecognition ?? (globalThis as any).webkitSpeechRecognition;
export const canListen = Boolean(RecognitionCtor);

/** Listen for one utterance. `onInterim` receives the live transcript for on-screen captions. */
export function listen(onInterim: (text: string) => void): { done: Promise<string>; stop: () => void } {
  if (!RecognitionCtor) return { done: Promise.reject(new Error('Speech recognition is not supported in this browser')), stop: () => {} };
  speechSynthesis.cancel();
  const rec: Recognition = new RecognitionCtor();
  rec.lang = 'en-US';
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  let finalText = '';
  const done = new Promise<string>((resolve, reject) => {
    rec.onresult = (e: any) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      onInterim((finalText + interim).trim());
    };
    rec.onerror = (e: any) => (e.error === 'no-speech' || e.error === 'aborted' ? resolve('') : reject(new Error(e.error)));
    rec.onend = () => resolve(finalText.trim());
  });
  rec.start();
  return { done, stop: () => rec.stop() };
}

/** A soft two-note chime for proactive notifications. */
export function chime(urgent = false) {
  try {
    const ctx = new AudioContext();
    const notes = urgent ? [880, 660, 880] : [660, 880];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      o.type = 'sine';
      g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.18);
      g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + i * 0.18 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.18 + 0.35);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.18);
      o.stop(ctx.currentTime + i * 0.18 + 0.4);
    });
  } catch {
    /* audio not available */
  }
}
