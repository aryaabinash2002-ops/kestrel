import { useEffect, useMemo } from 'react';
import { Check, SkipForward, Square } from 'lucide-react';
import { Button } from '@renderer/components/ui/button';
import { Textarea } from '@renderer/components/ui/textarea';
import { LevelMeter } from '@renderer/components/LevelMeter';
import { useAudio } from '@renderer/store/audio';
import { useSession } from '@renderer/store/session';
import { usePractice, type CurrentQuestion } from '@renderer/store/practice';

/**
 * Collects the spoken answer: ME finals that started after the question was shown, plus the
 * live interim. The user can edit the text before submitting.
 */
export function AnswerArea({ q }: { q: CurrentQuestion }) {
  const utterances = useSession((s) => s.utterances);
  const interim = useSession((s) => s.interim.ME);
  const level = useAudio((s) => s.levels.ME);
  const meStatus = useAudio((s) => s.state?.me);
  const stt = useAudio((s) => s.transcription.ME);
  const phase = usePractice((s) => s.phase);
  const edited = usePractice((s) => s.edited);
  const setEdited = usePractice((s) => s.setEdited);
  const submit = usePractice((s) => s.submit);
  const skip = usePractice((s) => s.skip);
  const stop = usePractice((s) => s.stop);

  const collected = useMemo(
    () =>
      utterances
        .filter((u) => u.isFinal && u.speaker === 'ME' && u.startMs >= q.shownAtMs - 500)
        .map((u) => u.text)
        .join(' '),
    [utterances, q.shownAtMs],
  );
  const text = edited ?? collected;
  const busy = phase === 'scoring';

  // New question → drop any manual edits from the previous one.
  useEffect(() => {
    setEdited(null);
  }, [q.shownAtMs, setEdited]);

  const sttHint =
    stt?.status === 'error'
      ? `Transcription unavailable (${stt.message ?? 'error'}) — type your answer instead.`
      : meStatus?.error
        ? `Microphone: ${meStatus.error} — type your answer instead.`
        : phase === 'speaking'
          ? 'Wait for the question to finish, then answer out loud.'
          : 'Answer out loud — your words appear here. Edit if needed, then press Done.';

  return (
    <div className="space-y-2 rounded-lg border border-border/70 bg-card/60 p-3">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold tracking-widest text-me">ME</span>
        <LevelMeter level={meStatus?.active ? level : 0} tone="me" className="flex-1" />
        <span className="truncate text-[10px] text-muted-foreground">{meStatus?.deviceLabel ?? ''}</span>
      </div>
      <Textarea
        rows={5}
        value={text}
        onChange={(e) => setEdited(e.target.value)}
        placeholder="Your answer will appear here as you speak…"
        className="text-[13px] leading-relaxed"
        disabled={busy}
      />
      {interim && phase !== 'scoring' && <p className="text-xs italic text-muted-foreground caret">{interim}</p>}
      <p className="text-[11px] text-muted-foreground">{sttHint}</p>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => void submit(text)} disabled={busy || phase === 'speaking' || !text.trim()}>
          <Check /> Done answering
        </Button>
        <Button size="sm" variant="outline" onClick={() => void skip()} disabled={busy}>
          <SkipForward /> Skip
        </Button>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => void stop()} disabled={busy}>
          <Square /> End
        </Button>
      </div>
    </div>
  );
}
