import { AlertTriangle, Mic, Volume2 } from 'lucide-react';
import type { ChannelStatus } from '@shared/types/audio';
import { LevelMeter } from './LevelMeter';
import { cn } from '@renderer/lib/utils';

const WARNING_LABEL: Record<string, string> = {
  'bluetooth-headset': 'Bluetooth call mode — use laptop mic',
  'no-signal': 'No signal',
};

export function ChannelStrip({ status, level, compact }: { status: ChannelStatus | null; level: number; compact?: boolean }) {
  const isMe = status?.channel === 'ME' || !status;
  const Icon = isMe ? Mic : Volume2;
  const tone = isMe ? 'me' : 'them';
  return (
    <div className={cn('flex items-center gap-2 rounded-md border border-border/60 bg-card/60 px-2', compact ? 'py-1' : 'py-1.5')}>
      <Icon className={cn('size-3.5 shrink-0', tone === 'me' ? 'text-me' : 'text-them', !status?.active && 'opacity-40')} />
      <span className={cn('w-10 shrink-0 text-[10px] font-bold tracking-widest', tone === 'me' ? 'text-me' : 'text-them')}>
        {isMe ? 'ME' : 'THEM'}
      </span>
      <LevelMeter level={status?.active ? level : 0} tone={tone} className="flex-1" />
      <span className="ml-1 max-w-[45%] truncate text-[10px] text-muted-foreground" title={status?.error ?? status?.deviceLabel ?? ''}>
        {status?.error ? (
          <span className="flex items-center gap-1 text-warning">
            <AlertTriangle className="size-3" /> {status.error}
          </span>
        ) : status?.warnings.length ? (
          <span className="text-warning">{WARNING_LABEL[status.warnings[0] ?? ''] ?? status.warnings[0]}</span>
        ) : (
          status?.deviceLabel ?? (status?.active ? 'Live' : 'Off')
        )}
      </span>
    </div>
  );
}
