import { cn } from '@renderer/lib/utils';

/** Segmented VU-style meter. `level` is 0..1. */
export function LevelMeter({
  level,
  tone,
  className,
  segments = 18,
}: {
  level: number;
  tone: 'me' | 'them';
  className?: string;
  segments?: number;
}) {
  const lit = Math.round(level * segments);
  return (
    <div
      className={cn('flex h-2 items-stretch gap-[2px]', className)}
      aria-label={`level ${Math.round(level * 100)}%`}
    >
      {Array.from({ length: segments }, (_, i) => {
        const on = i < lit;
        const hot = i >= segments - 3;
        return (
          <span
            key={i}
            className={cn(
              'flex-1 rounded-[1px] transition-colors duration-75',
              on
                ? hot
                  ? 'bg-destructive'
                  : tone === 'me'
                    ? 'bg-me'
                    : 'bg-them'
                : 'bg-muted-foreground/15',
            )}
          />
        );
      })}
    </div>
  );
}
