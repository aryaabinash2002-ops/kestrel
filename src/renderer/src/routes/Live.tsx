import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Mic, Square } from 'lucide-react';
import { Button } from '@renderer/components/ui/button';
import { Kbd } from '@renderer/components/ui/kbd';
import { ChannelStrip } from '@renderer/components/ChannelStrip';
import { TranscriptView } from '@renderer/components/TranscriptView';
import { TranscriptionStatus } from '@renderer/components/TranscriptionStatus';
import { useAudio } from '@renderer/store/audio';
import { useSession } from '@renderer/store/session';
import { useSettings } from '@renderer/store/settings';
import { prettyAccelerator } from '@renderer/lib/ipc';
import { toast } from '@renderer/store/toasts';
import { formatMs } from '@shared/utils';

export default function Live() {
  const audio = useAudio((s) => s.state);
  const levels = useAudio((s) => s.levels);
  const startAudio = useAudio((s) => s.start);
  const stopAudio = useAudio((s) => s.stop);
  const session = useSession((s) => s.state.session);
  const utterances = useSession((s) => s.utterances);
  const interim = useSession((s) => s.interim);
  const transcription = useAudio((s) => s.transcription);
  const profile = useSession((s) => s.state.profile);
  const startSession = useSession((s) => s.start);
  const stopSession = useSession((s) => s.stop);
  const hotkeys = useSettings((s) => s.settings.hotkeys);
  const compact = useSettings((s) => s.settings.ui.compact);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!session) return undefined;
    const t = setInterval(() => setElapsed(Date.now() - session.startedAt), 1000);
    return () => clearInterval(t);
  }, [session]);

  const listening = audio?.listening ?? false;

  const start = async () => {
    setBusy(true);
    try {
      if (!session) await startSession(profile?.id ?? null);
      await startAudio();
    } catch (err) {
      toast({ kind: 'error', title: 'Could not start listening', message: String(err) });
    } finally {
      setBusy(false);
    }
  };
  const stop = async () => {
    setBusy(true);
    try {
      await stopAudio();
    } finally {
      setBusy(false);
    }
  };
  const end = async () => {
    await stopAudio();
    await stopSession();
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 px-3 pt-2">
        {listening ? (
          <Button size="sm" variant="secondary" onClick={() => void stop()} disabled={busy}>
            <Square className="fill-current" /> Pause
          </Button>
        ) : (
          <Button size="sm" onClick={() => void start()} disabled={busy}>
            <Mic /> {session ? 'Resume' : 'Start listening'}
          </Button>
        )}
        {session && (
          <Button size="sm" variant="ghost" onClick={() => void end()} disabled={busy}>
            End session
          </Button>
        )}
        <div className="ml-auto flex items-center gap-2 text-[11px] text-muted-foreground">
          {session && <span className="tabular-nums">{formatMs(elapsed)}</span>}
          <Kbd>{prettyAccelerator(hotkeys.toggleListening)}</Kbd>
        </div>
      </div>
      <div className="shrink-0 space-y-1 px-3 pt-2">
        <ChannelStrip status={audio?.me ?? null} level={levels.ME} compact={compact} />
        <ChannelStrip status={audio?.them ?? null} level={levels.THEM} compact={compact} />
      </div>
      <TranscriptionStatus states={transcription} listening={listening} />
      <div className="flex min-h-0 flex-1 flex-col px-3 py-3">
        {!session ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-xs text-muted-foreground">
            <p>Start listening to transcribe both sides of the call.</p>
            <p>
              {profile ? (
                <>Profile: <b className="text-foreground">{profile.name}</b></>
              ) : (
                <>
                  No profile selected — answers will be generic. <Link to="/setup" className="text-primary underline">Set one up</Link>.
                </>
              )}
            </p>
          </div>
        ) : (
          <TranscriptView utterances={utterances} interim={interim} compact={compact} className="flex-1" />
        )}
      </div>
    </div>
  );
}
