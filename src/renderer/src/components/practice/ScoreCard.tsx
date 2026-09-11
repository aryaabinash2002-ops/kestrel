import { useState } from 'react';
import { ArrowRight, ChevronDown, ChevronUp, Lightbulb, Sparkles } from 'lucide-react';
import { Button } from '@renderer/components/ui/button';
import type { PracticeScore } from '@shared/types/session';
import { cn } from '@renderer/lib/utils';

function tone(n: number): string {
  return n >= 8 ? 'text-success' : n >= 5 ? 'text-warning' : 'text-destructive';
}
function bar(n: number): string {
  return n >= 8 ? 'bg-success' : n >= 5 ? 'bg-warning' : 'bg-destructive';
}

export function ScoreCard({ score, nextLabel, onNext }: { score: PracticeScore; nextLabel: string; onNext: () => void }) {
  const [showModel, setShowModel] = useState(false);
  const s = score.score;
  const subs: { label: string; value: number }[] = [
    { label: 'Relevance', value: s.relevance },
    { label: 'Structure', value: s.structure },
    { label: 'Specificity', value: s.specificity },
    { label: 'Conciseness', value: s.conciseness },
  ];
  return (
    <div className="card-in space-y-3 rounded-lg border border-primary/40 bg-card/80 p-3 shadow-sm">
      <div className="flex items-center gap-3">
        <div className={cn('text-4xl font-bold tabular-nums leading-none', tone(s.score))}>{s.score}</div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Overall / 10</div>
          <div className="truncate text-xs text-muted-foreground" title={score.question}>
            {score.question}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        {subs.map((x) => (
          <div key={x.label}>
            <div className="flex justify-between text-[11px]">
              <span className="text-muted-foreground">{x.label}</span>
              <span className={cn('font-semibold tabular-nums', tone(x.value))}>{x.value}</span>
            </div>
            <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-secondary">
              <div className={cn('h-full rounded-full', bar(x.value))} style={{ width: `${x.value * 10}%` }} />
            </div>
          </div>
        ))}
      </div>
      {s.strengths.length > 0 && (
        <div>
          <div className="mb-0.5 flex items-center gap-1 text-[11px] font-semibold text-success">
            <Sparkles className="size-3" /> Strengths
          </div>
          <ul className="list-disc space-y-0.5 pl-4 text-xs">
            {s.strengths.map((st, i) => (
              <li key={i}>{st}</li>
            ))}
          </ul>
        </div>
      )}
      {s.improve_one_thing && (
        <div className="rounded-md border border-warning/40 bg-warning/10 p-2">
          <div className="mb-0.5 flex items-center gap-1 text-[11px] font-semibold text-warning">
            <Lightbulb className="size-3" /> Improve one thing
          </div>
          <p className="text-xs selectable">{s.improve_one_thing}</p>
        </div>
      )}
      {s.model_answer && (
        <div>
          <button className="no-drag flex items-center gap-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground" onClick={() => setShowModel((v) => !v)}>
            {showModel ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />} Model answer
          </button>
          {showModel && <p className="mt-1 rounded-md bg-muted/40 p-2 text-xs leading-relaxed selectable">{s.model_answer}</p>}
        </div>
      )}
      <Button size="sm" onClick={onNext} className="w-full">
        {nextLabel} <ArrowRight />
      </Button>
    </div>
  );
}
