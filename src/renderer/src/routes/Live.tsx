import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Camera, ChevronDown, ChevronUp, Eraser, Mic, Square, Zap } from 'lucide-react';
import { Button } from '@renderer/components/ui/button';
import { Kbd } from '@renderer/components/ui/kbd';
import { ChannelStrip } from '@renderer/components/ChannelStrip';
import { TranscriptView } from '@renderer/components/TranscriptView';
import { TranscriptionStatus } from '@renderer/components/TranscriptionStatus';
import { AudioHints } from '@renderer/components/AudioHints';
import { AnswerCard } from '@renderer/components/AnswerCard';
import { ScreenshotCard } from '@renderer/components/ScreenshotCard';
import { ChatBox } from '@renderer/components/ChatBox';
import { StartSessionDialog } from '@renderer/components/setup/StartSessionDialog';
import { useProfiles } from '@renderer/store/profiles';
import { useAudio } from '@renderer/store/audio';
import { useSession } from '@renderer/store/session';
import { useSettings } from '@renderer/store/settings';
import { invoke, prettyAccelerator } from '@renderer/lib/ipc';
import { toast } from '@renderer/store/toasts';
import { formatMs } from '@shared/utils';
import { cn } from '@renderer/lib/utils';

export default function Live() {
  const audio = useAudio((s) => s.state);
  const levels = useAudio((s) => s.levels);
  const transcription = useAudio((s) => s.transcription);
  const extension = useAudio((s) => s.extension);
  const startAudio = useAudio((s) => s.start);
  const stopAudio = useAudio((s) => s.stop);
  const session = useSession((s) => s.state.session);
  const profile = useSession((s) => s.state.profile);
  const utterances = useSession((s) => s.utterances);
  const interim = useSession((s) => s.interim);
  const cards = useSession((s) => s.cards);
  const chips = useSession((s) => s.chips);
  const pending = useSession((s) => s.pendingQuestion);
  const dismissCard = useSession((s) => s.dismissCard);
  const screenshots = useSession((s) => s.screenshots);
  const dismissScreenshot = useSession((s) => s.dismissScreenshot);
  const clearCards = useSession((s) => s.clearCards);
  const stopSession = useSession((s) => s.stop);
  const hotkeys = useSettings((s) => s.settings.hotkeys);
  const lastProfileId = useSettings((s) => s.settings.lastProfileId);
  const loadProfiles = useProfiles((s) => s.load);
  const compact = useSettings((s) => s.settings.ui.compact);
  const showLatency = useSettings((s) => s.settings.ui.showLatency);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [transcriptOpen, setTranscriptOpen] = useState(!compact);
  const [params, setParams] = useSearchParams();
  const [startOpen, setStartOpen] = useState(!!params.get('start'));

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  useEffect(() => {
    if (!session) return undefined;
    const t = setInterval(() => setElapsed(Date.now() - session.startedAt), 1000);
    return () => clearInterval(t);
  }, [session]);

  const listening = audio?.listening ?? false;

  const start = async () => {
    if (!session) {
      // New session: profile + consent dialog (§11) before any audio is captured.
      setStartOpen(true);
      return;
    }
    setBusy(true);
    try {
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

  const visibleCards = cards.filter((c) => c.status !== 'dismissed');

  return (
    <div className="flex h-full flex-col">
      {startOpen && (
        <StartSessionDialog
          open
          onOpenChange={(o) => {
            setStartOpen(o);
            if (!o && params.get('start')) setParams({});
          }}
          initialProfileId={profile?.id ?? lastProfileId}
        />
      )}
      <div className="flex shrink-0 items-center gap-1.5 px-3 pt-2">
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
          <Button size="sm" variant="outline" onClick={() => void invoke('answer:now')} title={`Answer the last 30 s (${prettyAccelerator(hotkeys.answerNow)})`}>
            <Zap /> Answer now
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => void invoke('screenshot:solve', { region: true })} title={`Solve what's on screen (${prettyAccelerator(hotkeys.screenshotSolve)})`}>
          <Camera /> {compact ? '' : 'Solve screen'}
        </Button>
        <div className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {session && <span className="tabular-nums">{formatMs(elapsed)}</span>}
          {session ? (
            <Button size="xs" variant="ghost" onClick={() => void end()} disabled={busy}>
              End
            </Button>
          ) : (
            <Kbd>{prettyAccelerator(hotkeys.toggleListening)}</Kbd>
          )}
        </div>
      </div>
      <div className="shrink-0 space-y-1 px-3 pt-2">
        <ChannelStrip status={audio?.me ?? null} level={levels.ME} compact />
        <ChannelStrip status={audio?.them ?? null} level={levels.THEM} compact />
      </div>
      <TranscriptionStatus states={transcription} listening={listening} />
      <AudioHints audio={audio} extension={extension} />

      {!session ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-xs text-muted-foreground">
          <p>Start listening to transcribe both sides of the call and get answers as questions come up.</p>
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
        <>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
            {pending && !visibleCards.some((c) => c.status === 'streaming') && (
              <div className="card-in mb-2 rounded-md border border-dashed border-primary/40 px-3 py-1.5 text-[11px] text-muted-foreground">
                <span className="text-primary">Detected:</span> {pending}
              </div>
            )}
            {chips.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1">
                {chips.map((c) => (
                  <button
                    key={c.id}
                    className="no-drag rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] hover:bg-accent"
                    title="Smalltalk — click to get a suggested reply"
                    onClick={() => void invoke('answer:chat', `Give me a one-line friendly reply to: "${c.question}"`)}
                  >
                    💬 {c.question}
                  </button>
                ))}
              </div>
            )}
            {visibleCards.length === 0 && screenshots.length === 0 && !pending && (
              <div className="py-8 text-center text-xs text-muted-foreground">
                Answers appear here as questions are detected. Press <Kbd>{prettyAccelerator(hotkeys.answerNow)}</Kbd> to answer the last 30 seconds.
              </div>
            )}
            <div className="space-y-2">
              {screenshots.map((sh) => (
                <ScreenshotCard key={sh.id} shot={sh} onDismiss={dismissScreenshot} />
              ))}
              {visibleCards.map((c, i) => (
                <AnswerCard key={c.id} card={c} showLatency={showLatency} collapsedDefault={i >= 2} compact={compact} onDismiss={dismissCard} />
              ))}
            </div>
            {visibleCards.length > 1 && (
              <div className="pt-2 text-right">
                <Button size="xs" variant="ghost" onClick={clearCards}>
                  <Eraser /> Clear cards
                </Button>
              </div>
            )}
          </div>
          <div className={cn('shrink-0 border-t border-border/70 bg-card/40', transcriptOpen ? 'h-[32%] min-h-[120px]' : 'h-8')}>
            <button className="no-drag flex h-8 w-full items-center gap-1 px-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground" onClick={() => setTranscriptOpen((v) => !v)}>
              Transcript
              {!transcriptOpen && (interim.THEM || interim.ME) && <span className="ml-1 truncate normal-case tracking-normal opacity-70">{interim.THEM || interim.ME}</span>}
              <span className="ml-auto">{transcriptOpen ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}</span>
            </button>
            {transcriptOpen && <TranscriptView utterances={utterances} interim={interim} compact className="h-[calc(100%-2rem)] px-2 pb-2" />}
          </div>
          <ChatBox compact={compact} />
        </>
      )}
    </div>
  );
}
