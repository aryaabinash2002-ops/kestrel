import { useEffect, useRef, useState } from 'react';
import { ArrowDown } from 'lucide-react';
import type { Utterance } from '@shared/types/session';
import { formatMs } from '@shared/utils';
import { cn } from '@renderer/lib/utils';

export function TranscriptView({
  utterances,
  interim,
  className,
  compact,
}: {
  utterances: Utterance[];
  interim: { ME: string; THEM: string };
  className?: string;
  compact?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (el && pinned) el.scrollTop = el.scrollHeight;
  }, [utterances, interim, pinned]);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
  };

  const finals = utterances.filter((u) => u.isFinal);
  const empty = finals.length === 0 && !interim.ME && !interim.THEM;

  return (
    <div className={cn('relative min-h-0', className)}>
      <div
        ref={ref}
        onScroll={onScroll}
        className="h-full space-y-1.5 overflow-y-auto pr-1 selectable"
      >
        {empty && (
          <div className="py-6 text-center text-xs text-muted-foreground">Waiting for speech…</div>
        )}
        {finals.map((u) => (
          <Row
            key={u.id}
            speaker={u.speaker}
            name={u.speakerName}
            text={u.text}
            time={formatMs(u.startMs)}
            compact={compact}
          />
        ))}
        {interim.THEM && <Row speaker="THEM" text={interim.THEM} interim compact={compact} />}
        {interim.ME && <Row speaker="ME" text={interim.ME} interim compact={compact} />}
      </div>
      {!pinned && (
        <button
          className="absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-popover px-2 py-0.5 text-[10px] shadow no-drag"
          onClick={() => {
            setPinned(true);
            const el = ref.current;
            if (el) el.scrollTop = el.scrollHeight;
          }}
        >
          <ArrowDown className="size-3" /> Latest
        </button>
      )}
    </div>
  );
}

function Row({
  speaker,
  name,
  text,
  time,
  interim,
  compact,
}: {
  speaker: Utterance['speaker'];
  name?: string;
  text: string;
  time?: string;
  interim?: boolean;
  compact?: boolean;
}) {
  const tone = speaker === 'ME' ? 'text-me' : speaker === 'THEM' ? 'text-them' : 'text-primary';
  return (
    <div className={cn('flex gap-2 rounded-md px-1.5 py-1', interim && 'opacity-60')}>
      <div className="w-11 shrink-0 pt-0.5">
        <div className={cn('text-[10px] font-bold tracking-widest', tone)}>{speaker}</div>
        {!compact && (name || time) && (
          <div className="truncate text-[9px] text-muted-foreground">{name ?? time}</div>
        )}
      </div>
      <div
        className={cn(
          'min-w-0 flex-1 leading-snug',
          compact ? 'text-xs' : 'text-[13px]',
          interim && 'caret italic',
        )}
      >
        {text}
      </div>
    </div>
  );
}
