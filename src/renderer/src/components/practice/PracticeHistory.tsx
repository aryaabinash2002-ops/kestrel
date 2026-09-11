import { useState } from 'react';
import { ChevronDown, ChevronUp, History } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card';
import type { PracticeHistoryEntry } from '@shared/types/ipc';
import { cn } from '@renderer/lib/utils';

function tone(n: number): string {
  return n >= 8 ? 'text-success' : n >= 5 ? 'text-warning' : 'text-destructive';
}

export function PracticeHistory({ entries }: { entries: PracticeHistoryEntry[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (entries.length === 0) return null;
  const overall = entries.reduce((a, e) => a + e.avgScore * e.count, 0) / Math.max(1, entries.reduce((a, e) => a + e.count, 0));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          <History className="size-4" /> Progress
          <span className="ml-auto text-xs font-normal text-muted-foreground">
            {entries.length} session{entries.length === 1 ? '' : 's'} · avg <b className={tone(overall)}>{overall.toFixed(1)}</b>
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {entries.map((e) => (
          <div key={e.sessionId} className="rounded-md border border-border/60">
            <button className="no-drag flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs" onClick={() => setOpen(open === e.sessionId ? null : e.sessionId)}>
              <span className="text-muted-foreground">{new Date(e.startedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</span>
              <span className="text-muted-foreground">· {e.count} q</span>
              <span className={cn('ml-auto font-semibold tabular-nums', tone(e.avgScore))}>{e.avgScore.toFixed(1)}</span>
              {open === e.sessionId ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            </button>
            {open === e.sessionId && (
              <ul className="space-y-1 border-t border-border/60 px-2.5 py-1.5 text-[11px]">
                {e.scores.map((s) => (
                  <li key={s.id} className="flex gap-2">
                    <span className={cn('w-5 shrink-0 font-semibold tabular-nums', tone(s.score.score))}>{s.score.score}</span>
                    <span className="min-w-0 flex-1 truncate" title={s.question}>
                      {s.question}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
