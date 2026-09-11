import type { LatencySample } from '@shared/types/session';

/** Tiny dependency-free bar chart of first-token latency per answer (newest right). */
export function LatencyChart({ samples }: { samples: LatencySample[] }) {
  const pts = samples
    .filter((s) => s.firstTokenTs && s.questionEndTs)
    .slice(0, 60)
    .reverse()
    .map((s) => ({ v: (s.firstTokenTs ?? 0) - (s.questionEndTs ?? 0), spec: s.speculative, restart: s.restarted }));
  if (pts.length === 0) {
    return <div className="rounded-md border border-dashed border-border/60 p-4 text-center text-xs text-muted-foreground">No samples yet — run a session.</div>;
  }
  const max = Math.max(2000, ...pts.map((p) => Math.abs(p.v)));
  const W = 360;
  const H = 90;
  const bw = W / pts.length;
  const y = (v: number) => H - ((v + max) / (2 * max)) * H;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-24 w-full">
      <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke="currentColor" strokeOpacity={0.25} strokeDasharray="3 3" />
      <line x1={0} x2={W} y1={y(1000)} y2={y(1000)} stroke="var(--warning)" strokeOpacity={0.5} strokeDasharray="2 4" />
      <line x1={0} x2={W} y1={y(2000)} y2={y(2000)} stroke="var(--destructive)" strokeOpacity={0.4} strokeDasharray="2 4" />
      {pts.map((p, i) => {
        const top = Math.min(y(0), y(p.v));
        const h = Math.abs(y(0) - y(p.v));
        const fill = p.v <= 1000 ? 'var(--success)' : p.v <= 2000 ? 'var(--warning)' : 'var(--destructive)';
        return (
          <g key={i}>
            <rect x={i * bw + 1} y={top} width={Math.max(1, bw - 2)} height={Math.max(1, h)} fill={fill} opacity={p.spec ? 0.95 : 0.55} rx={1} />
            {p.restart && <circle cx={i * bw + bw / 2} cy={top - 3} r={1.5} fill="var(--primary)" />}
          </g>
        );
      })}
    </svg>
  );
}
