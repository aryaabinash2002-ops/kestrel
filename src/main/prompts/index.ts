import type { PromptName } from '@shared/types/settings';
import liveAnswer from './live_answer.md?raw';
import classifier from './classifier.md?raw';
import screenshotSolve from './screenshot_solve.md?raw';
import practiceInterviewer from './practice_interviewer.md?raw';
import practiceScorer from './practice_scorer.md?raw';
import review from './review.md?raw';
import summary from './summary.md?raw';

/** Built-in prompt templates (editable in Settings → Prompts). */
export const DEFAULT_PROMPTS: Record<PromptName, string> = {
  live_answer: liveAnswer,
  classifier,
  screenshot_solve: screenshotSolve,
  practice_interviewer: practiceInterviewer,
  practice_scorer: practiceScorer,
  review,
  summary,
};

/**
 * Minimal template renderer: `{var}` substitution and `{if flag}...{/if}` blocks.
 * Unknown variables render as empty strings.
 */
export function renderTemplate(template: string, vars: Record<string, string | boolean | undefined>): string {
  let out = template.replace(/\{if (\w+)\}([\s\S]*?)\{\/if\}/g, (_m, flag: string, body: string) =>
    vars[flag] ? body : '',
  );
  out = out.replace(/\{(\w+)\}/g, (_m, key: string) => {
    const v = vars[key];
    if (v === undefined || typeof v === 'boolean') return '';
    return v;
  });
  return out.replace(/\n{3,}/g, '\n\n').trim();
}
