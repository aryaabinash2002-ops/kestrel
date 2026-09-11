import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Copy,
  Download,
  FileText,
  FolderOpen,
  Loader2,
  Sparkles,
} from 'lucide-react';
import { Button } from '@renderer/components/ui/button';
import { Badge } from '@renderer/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@renderer/components/ui/tabs';
import { TranscriptView } from '@renderer/components/TranscriptView';
import { AnswerCard } from '@renderer/components/AnswerCard';
import { Markdown } from '@renderer/components/Markdown';
import { invoke } from '@renderer/lib/ipc';
import { toast } from '@renderer/store/toasts';
import { useReview, type SessionDetailData } from '@renderer/store/review';
import { useSettings } from '@renderer/store/settings';
import { sessionDate, sessionDuration } from './SessionList';
import { cn } from '@renderer/lib/utils';

const EMPTY_INTERIM = { ME: '', THEM: '' };
const noop = () => undefined;

function dirOf(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return i > 0 ? path.slice(0, i) : path;
}

export function SessionDetail({
  detail,
  onBack,
}: {
  detail: SessionDetailData;
  onBack: () => void;
}) {
  const { session, utterances, answers, screenshots } = detail;
  const generating = useReview((s) => s.generating);
  const exporting = useReview((s) => s.exporting);
  const generate = useReview((s) => s.generate);
  const exportSession = useReview((s) => s.exportSession);
  const autoTried = useReview((s) => s.autoTried);
  const hasAnthropic = useSettings((s) => s.secrets.anthropic);
  const [tab, setTab] = useState('summary');
  const summary = session.summary;
  const finals = utterances.filter((u) => u.isFinal);
  const doneAnswers = answers.filter((a) => a.status === 'done' && a.headline);

  const runGenerate = async () => {
    try {
      await generate(session.id);
      toast({ kind: 'success', title: 'Review ready' });
    } catch (err) {
      toast({
        kind: 'error',
        title: 'Could not generate the review',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  // Auto-generate once when a finished session with a transcript is opened without a review.
  useEffect(() => {
    if (
      summary ||
      !session.endedAt ||
      finals.length < 4 ||
      !hasAnthropic ||
      autoTried.has(session.id)
    )
      return;
    autoTried.add(session.id);
    void runGenerate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  const runExport = async (format: 'md' | 'pdf') => {
    try {
      const path = await exportSession(session.id, format);
      toast({
        kind: 'success',
        title: `Exported ${format === 'md' ? 'Markdown' : 'PDF'}`,
        message: path,
        sticky: true,
      });
      void invoke('app:openPath', dirOf(path));
    } catch (err) {
      toast({
        kind: 'error',
        title: 'Export failed',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-start gap-2 px-3 pt-2">
        <Button size="iconSm" variant="ghost" onClick={onBack} title="All sessions">
          <ArrowLeft />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-sm font-semibold">
              {session.profileName ??
                (session.mode === 'practice' ? 'Practice session' : 'Live session')}
            </h1>
            {!session.endedAt && <Badge variant="success">Live</Badge>}
          </div>
          <p className="text-[11px] text-muted-foreground">
            {sessionDate(session.startedAt)} · {sessionDuration(session)} · {finals.length} lines ·{' '}
            {doneAnswers.length} answers
            {screenshots.length ? ` · ${screenshots.length} screenshots` : ''}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 px-3 pt-2">
        <Button
          size="sm"
          onClick={() => void runGenerate()}
          disabled={generating || finals.length === 0}
          title={finals.length === 0 ? 'Nothing was transcribed in this session' : undefined}
        >
          {generating ? <Loader2 className="animate-spin" /> : <Sparkles />}{' '}
          {summary ? 'Regenerate review' : 'Generate review'}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void runExport('md')}
          disabled={exporting !== null}
          title="Export as Markdown"
        >
          {exporting === 'md' ? <Loader2 className="animate-spin" /> : <Download />} Markdown
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void runExport('pdf')}
          disabled={exporting !== null}
          title="Export as PDF"
        >
          {exporting === 'pdf' ? <Loader2 className="animate-spin" /> : <FileText />} PDF
        </Button>
      </div>
      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col px-3 pt-2">
        <TabsList className="w-full justify-start">
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="transcript">Transcript</TabsTrigger>
          <TabsTrigger value="answers">
            Answers{doneAnswers.length ? ` (${doneAnswers.length})` : ''}
          </TabsTrigger>
          {screenshots.length > 0 && <TabsTrigger value="screenshots">Screens</TabsTrigger>}
        </TabsList>
        <div className="min-h-0 flex-1 overflow-y-auto pb-3">
          <TabsContent value="summary" className="space-y-3">
            {!summary ? (
              <Card className="border-dashed">
                <CardContent className="py-6 text-center text-xs text-muted-foreground">
                  {generating ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 className="size-4 animate-spin" /> Reviewing the conversation…
                    </span>
                  ) : finals.length === 0 ? (
                    'Nothing was transcribed in this session, so there is nothing to review.'
                  ) : hasAnthropic ? (
                    'Press Generate review for a summary, the questions asked, weak spots, a follow-up email and action items.'
                  ) : (
                    'Add your Anthropic API key in Settings → Keys to generate reviews.'
                  )}
                </CardContent>
              </Card>
            ) : (
              <>
                <Section title="Summary">
                  <p className="whitespace-pre-wrap text-[13px] leading-snug selectable">
                    {summary.summary}
                  </p>
                </Section>
                <Section title={`Questions asked (${summary.questions.length})`}>
                  {summary.questions.length ? (
                    <ol className="ml-4 list-decimal space-y-1 text-[13px] selectable">
                      {summary.questions.map((q, i) => (
                        <li key={i}>{q}</li>
                      ))}
                    </ol>
                  ) : (
                    <Empty>No questions were detected.</Empty>
                  )}
                </Section>
                <Section title="Weak spots">
                  {summary.weakSpots.length ? (
                    <ul className="space-y-1.5 text-[13px] selectable">
                      {summary.weakSpots.map((w, i) => (
                        <li
                          key={i}
                          className="rounded-md border border-warning/30 bg-warning/5 px-2.5 py-1.5 leading-snug"
                        >
                          {w}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <Empty>No weak spots noted — nice work.</Empty>
                  )}
                </Section>
                <Section
                  title="Follow-up email"
                  action={<CopyButton text={summary.followUpEmail} label="Copy email" />}
                >
                  <pre className="whitespace-pre-wrap rounded-md border border-border/60 bg-muted/30 p-2.5 font-sans text-[12.5px] leading-snug selectable">
                    {summary.followUpEmail || 'Not generated.'}
                  </pre>
                </Section>
                <Section title="Action items">
                  {summary.actionItems.length ? (
                    <ul className="space-y-1 text-[13px] selectable">
                      {summary.actionItems.map((a, i) => (
                        <li key={i} className="flex gap-2">
                          <span className="mt-[3px] size-3 shrink-0 rounded-sm border border-primary/60" />
                          <span className="leading-snug">{a}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <Empty>None.</Empty>
                  )}
                </Section>
                <p className="text-[10px] text-muted-foreground">
                  Generated {new Date(summary.generatedAt).toLocaleString()}
                </p>
              </>
            )}
          </TabsContent>
          <TabsContent value="transcript" className="h-full">
            <TranscriptView utterances={utterances} interim={EMPTY_INTERIM} className="h-full" />
          </TabsContent>
          <TabsContent value="answers" className="space-y-2">
            {doneAnswers.length === 0 && (
              <Empty>No answers were suggested during this session.</Empty>
            )}
            {doneAnswers.map((a) => (
              <AnswerCard
                key={a.id}
                card={a}
                showLatency={false}
                collapsedDefault={false}
                onDismiss={noop}
              />
            ))}
          </TabsContent>
          <TabsContent value="screenshots" className="space-y-2">
            {screenshots.map((s) => (
              <Card key={s.id}>
                <CardHeader className="pb-1">
                  <CardTitle className="flex items-center justify-between text-xs">
                    <span>{new Date(s.createdAt).toLocaleTimeString()}</span>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => void invoke('app:openPath', s.path)}
                      title={s.path}
                    >
                      <FolderOpen /> Open image
                    </Button>
                  </CardTitle>
                </CardHeader>
                <CardContent className="selectable">
                  {s.result ? <Markdown text={s.result} /> : <Empty>No result recorded.</Empty>}
                </CardContent>
              </Card>
            ))}
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between pb-1">
        <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">
          {title}
        </CardTitle>
        {action}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="xs"
      variant="ghost"
      disabled={!text}
      className={cn(copied && 'text-success')}
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check /> : <Copy />} {copied ? 'Copied' : label}
    </Button>
  );
}
