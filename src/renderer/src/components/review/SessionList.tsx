import { useState } from 'react';
import { Clock, FileText, GraduationCap, MessageSquareText, Radio, Trash2 } from 'lucide-react';
import { Card, CardContent } from '@renderer/components/ui/card';
import { Button } from '@renderer/components/ui/button';
import { Badge } from '@renderer/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@renderer/components/ui/dialog';
import { formatMs } from '@shared/utils';
import { cn } from '@renderer/lib/utils';
import type { SessionRow } from '@renderer/store/review';

export function sessionDate(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return `Today, ${time}`;
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })}, ${time}`;
}

export function sessionDuration(s: { startedAt: number; endedAt: number | null }): string {
  return s.endedAt ? formatMs(s.endedAt - s.startedAt) : 'live';
}

export function SessionList({ sessions, activeId, onOpen, onDelete }: { sessions: SessionRow[]; activeId: string | null; onOpen: (id: string) => void; onDelete: (id: string) => Promise<void> }) {
  const [confirm, setConfirm] = useState<SessionRow | null>(null);
  const [busy, setBusy] = useState(false);

  if (sessions.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
          <FileText className="size-6 text-primary" />
          <p className="text-sm">No sessions yet</p>
          <p className="max-w-xs text-xs text-muted-foreground">Every live or practice session ends up here with its transcript, the answers you were shown, and an AI review you can export.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      {sessions.map((s) => {
        const live = s.id === activeId;
        return (
          <Card key={s.id} className={cn('transition-colors hover:border-primary/40', live && 'border-primary/60')}>
            <CardContent className="flex items-start gap-2 p-3">
              <button className="no-drag min-w-0 flex-1 text-left" onClick={() => onOpen(s.id)} title="Open session">
                <div className="flex items-center gap-2">
                  {s.mode === 'practice' ? <GraduationCap className="size-3.5 shrink-0 text-primary" /> : <Radio className="size-3.5 shrink-0 text-primary" />}
                  <span className="truncate text-sm font-semibold">{s.profileName ?? (s.mode === 'practice' ? 'Practice session' : 'Live session')}</span>
                  {live && <Badge variant="success">Live</Badge>}
                  {s.summary && <Badge variant="secondary">Reviewed</Badge>}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                  <span>{sessionDate(s.startedAt)}</span>
                  <span className="flex items-center gap-1">
                    <Clock className="size-3" /> {sessionDuration(s)}
                  </span>
                  <span className="flex items-center gap-1">
                    <MessageSquareText className="size-3" /> {s.utteranceCount} lines · {s.answerCount} answers
                  </span>
                </div>
              </button>
              <Button size="iconSm" variant="ghost" className="shrink-0 text-muted-foreground hover:text-destructive" title="Delete session" onClick={() => setConfirm(s)} disabled={live}>
                <Trash2 />
              </Button>
            </CardContent>
          </Card>
        );
      })}
      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogTitle>Delete this session?</DialogTitle>
          <DialogDescription>
            {confirm ? `${confirm.profileName ?? 'Session'} from ${sessionDate(confirm.startedAt)} — the transcript, answers, screenshots and review will be removed permanently.` : ''}
          </DialogDescription>
          <div className="flex justify-end gap-2 pt-1">
            <Button size="sm" variant="outline" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                if (!confirm) return;
                setBusy(true);
                try {
                  await onDelete(confirm.id);
                } finally {
                  setBusy(false);
                  setConfirm(null);
                }
              }}
            >
              <Trash2 /> Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
