import { cn } from '@renderer/lib/utils';

export function ListeningIndicator({ listening, active }: { listening: boolean; active: boolean }) {
  if (!listening && !active) return null;
  return (
    <div
      className={cn(
        'no-drag flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
        listening
          ? 'border-destructive/40 bg-destructive/10 text-destructive'
          : 'border-border text-muted-foreground',
      )}
      title={
        listening ? 'Audio is being captured and transcribed' : 'Session active, not capturing'
      }
    >
      <span
        className={cn(
          'size-1.5 rounded-full',
          listening ? 'bg-destructive pulse-dot' : 'bg-muted-foreground',
        )}
      />
      {listening ? 'Listening' : 'Paused'}
    </div>
  );
}
