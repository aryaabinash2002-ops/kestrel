import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@renderer/components/ui/card';
import { Button } from '@renderer/components/ui/button';
import { invoke } from '@renderer/lib/ipc';
import type { DiagnosticsData } from '@shared/types/ipc';
import { LatencyChart } from '@renderer/components/LatencyChart';

export function Diagnostics() {
  const [data, setData] = useState<DiagnosticsData | null>(null);
  const refresh = () => void invoke('diagnostics:get').then(setData).catch(() => setData(null));
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, []);

  const samples = (data?.latency ?? []).filter((s) => s.firstTokenTs && s.questionEndTs);
  const ftl = samples.map((s) => (s.firstTokenTs ?? 0) - (s.questionEndTs ?? 0)).sort((a, b) => a - b);
  const hl = samples
    .filter((s) => s.headlineDoneTs)
    .map((s) => (s.headlineDoneTs ?? 0) - (s.questionEndTs ?? 0))
    .sort((a, b) => a - b);
  const pct = (arr: number[], p: number) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor((p / 100) * arr.length))] : null);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Answer latency</CardTitle>
          <CardDescription>Milliseconds from the interviewer’s last word to the first answer token (target ≤ 1000 p50, ≤ 2000 p95) and to the finished headline (≤ 1500 p50). Negative values mean the answer started before they finished.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="First token p50" value={pct(ftl, 50)} />
            <Stat label="First token p95" value={pct(ftl, 95)} />
            <Stat label="Headline p50" value={pct(hl, 50)} />
            <Stat label="Samples" value={samples.length} unit="" />
            <Stat label="Speculative" value={samples.length ? Math.round((100 * samples.filter((s) => s.speculative).length) / samples.length) : null} unit="%" />
            <Stat label="Restarts" value={data ? Math.round(data.speculativeRestartRate * 100) : null} unit="%" />
          </div>
          <LatencyChart samples={data?.latency ?? []} />
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={refresh}>
              Refresh
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void invoke('diagnostics:clear').then(refresh)}>
              Clear samples
            </Button>
          </div>
        </CardContent>
      </Card>
      {data?.transcriberStats && data.transcriberStats.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Transcription</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-xs">
            {data.transcriberStats.map((t) => (
              <div key={t.channel} className="flex justify-between">
                <span className="font-medium">{t.channel}</span>
                <span className="text-muted-foreground">
                  {t.interimCount} interim · {t.finalCount} final · {Math.round(t.avgInterimGapMs)} ms between interims
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value, unit = 'ms' }: { label: string; value: number | null | undefined; unit?: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/30 p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-base font-semibold tabular-nums">
        {value === null || value === undefined ? '—' : `${Math.round(value)}${unit}`}
      </div>
    </div>
  );
}
