import { Loader2, Mic, RotateCcw, Volume2 } from 'lucide-react';
import { Button } from '@renderer/components/ui/button';
import { Badge } from '@renderer/components/ui/badge';
import type { PracticePhase, CurrentQuestion } from '@renderer/store/practice';
import { cn } from '@renderer/lib/utils';

const CATEGORY_LABEL: Record<string, string> = {
  behavioral: 'Behavioral',
  coding: 'Coding',
  system_design: 'System design',
  role: 'Role-specific',
};

export function QuestionCard({
  q,
  phase,
  onReplay,
  useTts,
}: {
  q: CurrentQuestion;
  phase: PracticePhase;
  onReplay: () => void;
  useTts: boolean;
}) {
  const pill =
    phase === 'speaking'
      ? {
          label: 'Speaking…',
          icon: <Volume2 className="size-3" />,
          cls: 'border-primary/50 text-primary',
        }
      : phase === 'listening'
        ? {
            label: 'Listening…',
            icon: <Mic className="size-3 pulse-dot" />,
            cls: 'border-destructive/50 text-destructive',
          }
        : phase === 'scoring'
          ? {
              label: 'Scoring…',
              icon: <Loader2 className="size-3 animate-spin" />,
              cls: 'border-warning/50 text-warning',
            }
          : null;
  return (
    <div className="rounded-lg border border-border/70 bg-card/80 p-3 shadow-sm">
      <div className="flex items-center gap-2">
        <Badge variant="secondary">{CATEGORY_LABEL[q.category] ?? q.category}</Badge>
        <span className="text-[11px] text-muted-foreground">
          Question {q.index + 1} of {q.total}
        </span>
        <span className="ml-auto flex items-center gap-1">
          {pill && (
            <span
              className={cn(
                'flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                pill.cls,
              )}
            >
              {pill.icon} {pill.label}
            </span>
          )}
          {useTts && (
            <Button
              size="iconSm"
              variant="ghost"
              onClick={onReplay}
              title="Read the question again"
              disabled={phase === 'scoring'}
            >
              <RotateCcw />
            </Button>
          )}
        </span>
      </div>
      <p className="mt-2 text-[15px] font-semibold leading-snug selectable">{q.question}</p>
    </div>
  );
}
