import { cn } from '@renderer/lib/utils';

export function Progress({
  value,
  className,
  tone,
}: {
  value: number;
  className?: string;
  tone?: 'primary' | 'me' | 'them';
}) {
  const color = tone === 'me' ? 'bg-me' : tone === 'them' ? 'bg-them' : 'bg-primary';
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-secondary', className)}>
      <div
        className={cn('h-full transition-[width] duration-75', color)}
        style={{ width: `${Math.round(Math.min(100, Math.max(0, value * 100)))}%` }}
      />
    </div>
  );
}
