import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { RotateCcw, Trophy } from 'lucide-react';
import { Page } from '@renderer/components/Page';
import { Button } from '@renderer/components/ui/button';
import { Card, CardContent } from '@renderer/components/ui/card';
import { PracticeSetup } from '@renderer/components/practice/PracticeSetup';
import { QuestionCard } from '@renderer/components/practice/QuestionCard';
import { AnswerArea } from '@renderer/components/practice/AnswerArea';
import { ScoreCard } from '@renderer/components/practice/ScoreCard';
import { PracticeHistory } from '@renderer/components/practice/PracticeHistory';
import { speak, stopSpeaking } from '@renderer/components/practice/tts';
import { usePractice } from '@renderer/store/practice';
import { useSession } from '@renderer/store/session';
import { useSettings } from '@renderer/store/settings';
import { cn } from '@renderer/lib/utils';

function tone(n: number): string {
  return n >= 8 ? 'text-success' : n >= 5 ? 'text-warning' : 'text-destructive';
}

export default function Practice() {
  const phase = usePractice((s) => s.phase);
  const current = usePractice((s) => s.current);
  const pending = usePractice((s) => s.pending);
  const finishedPending = usePractice((s) => s.finishedPending);
  const lastScore = usePractice((s) => s.lastScore);
  const scores = usePractice((s) => s.scores);
  const error = usePractice((s) => s.error);
  const useTts = usePractice((s) => s.useTts);
  const history = usePractice((s) => s.history);
  const loadHistory = usePractice((s) => s.loadHistory);
  const next = usePractice((s) => s.next);
  const setPhase = usePractice((s) => s.setPhase);
  const reset = usePractice((s) => s.reset);
  const profile = useSession((s) => s.state.profile);
  const lastProfileId = useSettings((s) => s.settings.lastProfileId);
  const spokenFor = useRef<number | null>(null);

  const historyProfileId = profile?.id ?? lastProfileId ?? null;
  useEffect(() => {
    void loadHistory(historyProfileId);
  }, [historyProfileId, loadHistory, phase]);

  // Deep link / smoke helper: #/practice?start=coding&count=3&tts=0[&autosubmit=1]
  const [params] = useSearchParams();
  const autoStart = params.get('start');
  const autoSubmit = params.get('autosubmit') === '1';
  const startedFromLink = useRef(false);
  useEffect(() => {
    if (!autoStart || startedFromLink.current) return;
    startedFromLink.current = true;
    void usePractice
      .getState()
      .start({
        profileId: null,
        setId: autoStart,
        count: Number(params.get('count') ?? 3),
        useTts: params.get('tts') === '1',
      })
      .catch(() => undefined);
  }, [autoStart, params]);
  useEffect(() => {
    if (!autoSubmit || phase !== 'listening' || !current) return;
    const t = setTimeout(
      () =>
        void usePractice
          .getState()
          .submit(
            'At Globex I led the billing migration to Stripe with zero downtime, cutting payment failures from 12% to 1%.',
          ),
      800,
    );
    return () => clearTimeout(t);
  }, [autoSubmit, phase, current]);

  // Speak each question once when it becomes current (TTS on), then switch to listening.
  useEffect(() => {
    if (!current || phase !== 'speaking') return;
    if (spokenFor.current === current.shownAtMs) return;
    spokenFor.current = current.shownAtMs;
    let cancelled = false;
    void speak(current.question).then(() => {
      if (!cancelled && usePractice.getState().phase === 'speaking') setPhase('listening');
    });
    return () => {
      cancelled = true;
    };
  }, [current, phase, setPhase]);

  useEffect(() => () => stopSpeaking(), []);

  const replay = () => {
    if (!current) return;
    setPhase('speaking');
    spokenFor.current = null;
    void speak(current.question).then(() => {
      if (usePractice.getState().phase === 'speaking') setPhase('listening');
    });
  };

  const inSession = phase !== 'idle' && phase !== 'finished' && phase !== 'starting';
  const avg = scores.length ? scores.reduce((a, s) => a + s.score.score, 0) / scores.length : 0;

  return (
    <Page
      title="Practice"
      subtitle={inSession ? undefined : 'Rehearse with an AI interviewer and get scored feedback.'}
      scroll
    >
      {error && (
        <div className="mb-2 rounded-md border border-destructive/50 bg-destructive/10 px-2.5 py-1.5 text-[11px] text-destructive">
          {error}
        </div>
      )}

      {(phase === 'idle' || phase === 'starting') && (
        <div className="space-y-4">
          <PracticeSetup />
          <PracticeHistory entries={history} />
        </div>
      )}

      {inSession && current && (
        <div className="space-y-3">
          <div className="h-1 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full bg-primary transition-[width]"
              style={{
                width: `${((current.index + (phase === 'score' ? 1 : 0)) / current.total) * 100}%`,
              }}
            />
          </div>
          <QuestionCard q={current} phase={phase} onReplay={replay} useTts={useTts} />
          {phase === 'score' && lastScore ? (
            <ScoreCard
              score={lastScore}
              nextLabel={
                finishedPending || (!pending && current.index + 1 >= current.total)
                  ? 'See results'
                  : 'Next question'
              }
              onNext={next}
            />
          ) : (
            <AnswerArea q={current} />
          )}
        </div>
      )}

      {phase === 'finished' && (
        <div className="space-y-4">
          <Card className="border-primary/40">
            <CardContent className="flex flex-col items-center gap-2 py-6 text-center">
              <Trophy className="size-8 text-primary" />
              <div className="text-sm font-semibold">Practice complete</div>
              {scores.length ? (
                <>
                  <div className={cn('text-4xl font-bold tabular-nums', tone(avg))}>
                    {avg.toFixed(1)}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    average over {scores.length} scored answer{scores.length === 1 ? '' : 's'}
                  </div>
                  <ul className="mt-2 w-full space-y-1 text-left text-xs">
                    {scores.map((s) => (
                      <li
                        key={s.id}
                        className="flex gap-2 rounded-md border border-border/60 px-2 py-1"
                      >
                        <span
                          className={cn(
                            'w-5 shrink-0 font-semibold tabular-nums',
                            tone(s.score.score),
                          )}
                        >
                          {s.score.score}
                        </span>
                        <span className="min-w-0 flex-1">
                          <div className="truncate" title={s.question}>
                            {s.question}
                          </div>
                          {s.score.improve_one_thing && (
                            <div className="truncate text-[11px] text-muted-foreground">
                              {s.score.improve_one_thing}
                            </div>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <div className="text-[11px] text-muted-foreground">No answers were scored.</div>
              )}
              <Button size="sm" className="mt-2" onClick={reset}>
                <RotateCcw /> Practice again
              </Button>
            </CardContent>
          </Card>
          <PracticeHistory entries={history} />
        </div>
      )}
    </Page>
  );
}
