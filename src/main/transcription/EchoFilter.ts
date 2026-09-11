import { textSimilarity } from '@shared/utils';

interface Seen {
  text: string;
  at: number;
}

/**
 * When the user is on speakers, the microphone hears the other party too and the
 * ME channel would duplicate THEM. Any ME utterance that is >70% similar to something
 * heard on THEM within the last `windowMs` is dropped.
 */
export class EchoFilter {
  private them: Seen[] = [];

  constructor(
    private windowMs = 3000,
    private threshold = 0.7,
  ) {}

  /** Record THEM text (interim or final). */
  noteThem(text: string, at = Date.now()): void {
    const t = text.trim();
    if (!t) return;
    this.them.push({ text: t, at });
    this.prune(at);
  }

  /** Returns true when an ME utterance should be dropped as an echo of THEM. */
  isEcho(meText: string, at = Date.now()): boolean {
    this.prune(at);
    const t = meText.trim();
    if (!t) return false;
    const meWords = t.split(/\s+/).length;
    for (const s of this.them) {
      if (textSimilarity(t, s.text) > this.threshold) return true;
      // Short ME fragments that are fully contained in a longer THEM phrase are echoes too.
      if (meWords >= 3 && s.text.toLowerCase().includes(t.toLowerCase())) return true;
    }
    return false;
  }

  private prune(now: number): void {
    const cutoff = now - this.windowMs;
    while (this.them.length && (this.them[0]?.at ?? 0) < cutoff) this.them.shift();
    if (this.them.length > 50) this.them.splice(0, this.them.length - 50);
  }

  reset(): void {
    this.them = [];
  }
}
