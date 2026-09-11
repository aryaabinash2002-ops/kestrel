import { useEffect, useState } from 'react';
import { CheckCircle2, ExternalLink, Loader2, XCircle } from 'lucide-react';
import { Button } from '@renderer/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@renderer/components/ui/dialog';
import { LevelMeter } from '@renderer/components/LevelMeter';
import { invoke } from '@renderer/lib/ipc';
import { useAudio } from '@renderer/store/audio';
import { useSession } from '@renderer/store/session';
import { cn } from '@renderer/lib/utils';

/**
 * §2.5 "Test with Meet": join Meet's audio check, confirm THEM shows levels and transcribes.
 * Runs a throw-away live session that is deleted when the dialog closes.
 */
export function TestWithMeet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const levels = useAudio((s) => s.levels);
  const audio = useAudio((s) => s.state);
  const extension = useAudio((s) => s.extension);
  const transcription = useAudio((s) => s.transcription);
  const utterances = useSession((s) => s.utterances);
  const interim = useSession((s) => s.interim);
  const session = useSession((s) => s.state.session);
  const [testSessionId, setTestSessionId] = useState<string | null>(null);
  const [peak, setPeak] = useState(0);
  const [busy, setBusy] = useState(false);
  // Track the loudest THEM level seen while the dialog is open (store subscription, not an effect body).
  useEffect(() => useAudio.subscribe((s) => setPeak((p) => Math.max(p, s.levels.THEM))), []);

  const begin = async () => {
    setBusy(true);
    try {
      const st = await invoke('session:start', { profileId: null, mode: 'live' });
      setTestSessionId(st.session?.id ?? null);
      await invoke('audio:start');
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    if (testSessionId) {
      await invoke('audio:stop');
      await invoke('session:stop');
      await invoke('session:delete', testSessionId);
      setTestSessionId(null);
    }
    setPeak(0);
    onOpenChange(false);
  };

  const themText = interim.THEM || [...utterances].reverse().find((u) => u.speaker === 'THEM')?.text || '';
  const sttState = transcription.THEM?.status;
  const running = !!testSessionId && session?.id === testSessionId;

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(o) : void finish())}>
      <DialogContent>
        <DialogTitle>Test with Google Meet</DialogTitle>
        <DialogDescription>Confirms that the other party's audio reaches Kestrel and is transcribed.</DialogDescription>
        <ol className="list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
          <li>
            Open Meet and start a test meeting, then use <b>Check your audio and video</b> (the green-room preview) and play the test sound — or have a friend join and talk.
            <Button size="xs" variant="link" className="h-auto px-1" onClick={() => void invoke('app:openExternal', 'https://meet.google.com/new')}>
              Open Meet <ExternalLink />
            </Button>
          </li>
          <li>In Meet → Settings → Audio, make sure the <b>Speaker</b> is the device Kestrel captures{audio?.them.deviceLabel ? ` (${audio.them.deviceLabel})` : ''}. With the extension, click the Kestrel icon on the Meet tab once.</li>
          <li>Press <b>Start test</b> and speak or play the test sound.</li>
        </ol>
        {!running ? (
          <Button size="sm" onClick={() => void begin()} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : null} Start test
          </Button>
        ) : (
          <div className="space-y-2 rounded-md border border-border/60 p-2.5">
            <Row ok={peak > 0.08} label="THEM audio level">
              <LevelMeter level={levels.THEM} tone="them" className="w-32" />
            </Row>
            <Row ok={sttState === 'open'} label={`Transcription (${transcription.THEM?.provider ?? '—'})`}>
              <span className="text-[11px] text-muted-foreground">{sttState ?? 'idle'}{transcription.THEM?.message ? ` — ${transcription.THEM.message}` : ''}</span>
            </Row>
            <Row ok={!!themText} label="Transcribed text">
              <span className="max-w-[60%] truncate text-[11px] text-muted-foreground">{themText || '…'}</span>
            </Row>
            {extension?.status === 'capturing' && <p className="text-[11px] text-success">Audio is coming from the Meet extension.</p>}
            {audio?.them.error && <p className="text-[11px] text-warning">{audio.them.error}</p>}
          </div>
        )}
        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={() => void finish()}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Row({ ok, label, children }: { ok: boolean; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      {ok ? <CheckCircle2 className="size-4 text-success" /> : <XCircle className={cn('size-4', 'text-muted-foreground/50')} />}
      <span className="w-36 shrink-0">{label}</span>
      <span className="ml-auto flex items-center">{children}</span>
    </div>
  );
}
