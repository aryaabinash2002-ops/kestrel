/**
 * Incremental parser for the strict live-answer format:
 *
 *   HEADLINE: one sentence
 *   POINTS:
 *   - point
 *   - point
 *
 * Works on partial (streaming) text so the UI can show the headline as soon as its
 * line is complete, and each point as soon as its line is complete.
 */
export interface ParsedAnswer {
  headline: string;
  /** True once the headline line has been terminated by a newline (or POINTS: seen). */
  headlineDone: boolean;
  points: string[];
  /** The point currently being streamed (not yet newline-terminated). */
  partialPoint: string;
  /** Anything that did not fit the format (fallback rendering). */
  extra: string;
}

const HEADLINE_RE = /^\s*\**\s*HEADLINE\s*:\**\s*/i;
const POINTS_RE = /^\s*\**\s*POINTS\s*:\**\s*$/i;
const BULLET_RE = /^\s*(?:[-*•]|\d+[.)])\s+/;

export function parseAnswer(text: string): ParsedAnswer {
  const out: ParsedAnswer = { headline: '', headlineDone: false, points: [], partialPoint: '', extra: '' };
  if (!text) return out;
  const lines = text.split('\n');
  const lastIdx = lines.length - 1;
  let section: 'pre' | 'headline' | 'points' = 'pre';
  const extra: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? '';
    const complete = i < lastIdx;
    const line = raw.replace(/\r$/, '');
    if (HEADLINE_RE.test(line)) {
      out.headline = line.replace(HEADLINE_RE, '').trim();
      out.headlineDone = complete;
      section = 'headline';
      continue;
    }
    if (POINTS_RE.test(line)) {
      if (section === 'headline') out.headlineDone = true;
      section = 'points';
      continue;
    }
    if (section === 'headline' && !BULLET_RE.test(line) && line.trim()) {
      // Headline wrapped onto a second line (rare): append, keep headlineDone as-is so the
      // UI could already show the first line.
      out.headline = `${out.headline} ${line.trim()}`.trim();
      out.headlineDone = out.headlineDone || complete;
      continue;
    }
    if (BULLET_RE.test(line)) {
      if (section === 'headline') out.headlineDone = true;
      section = 'points';
      const p = line.replace(BULLET_RE, '').trim();
      if (complete) {
        if (p) out.points.push(p);
      } else out.partialPoint = p;
      continue;
    }
    if (section === 'points' && line.trim() && out.points.length) {
      // Continuation of the previous bullet.
      if (complete) out.points[out.points.length - 1] += ` ${line.trim()}`;
      else out.partialPoint = out.partialPoint ? `${out.partialPoint} ${line.trim()}` : line.trim();
      continue;
    }
    if (line.trim()) extra.push(line.trim());
  }
  if (!out.headline && extra.length) {
    // Model ignored the format: use the first sentence as the headline, the rest as points.
    const first = extra.shift() ?? '';
    out.headline = first;
    out.headlineDone = extra.length > 0 || text.endsWith('\n');
    out.points.push(...extra);
    return out;
  }
  out.extra = extra.join('\n');
  return out;
}

/** Strip markdown emphasis the model sometimes adds despite instructions. */
export function cleanInline(s: string): string {
  return s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1').trim();
}
