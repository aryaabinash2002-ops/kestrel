import { cn } from '@renderer/lib/utils';

export function Page({
  title,
  subtitle,
  actions,
  children,
  className,
  scroll = true,
}: {
  title?: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  scroll?: boolean;
}) {
  return (
    <div className="flex h-full flex-col">
      {(title || actions) && (
        <div className="flex shrink-0 items-start justify-between gap-2 px-4 pb-2 pt-3">
          <div>
            {title && <h1 className="text-base font-semibold leading-tight">{title}</h1>}
            {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
        </div>
      )}
      <div className={cn('min-h-0 flex-1 px-4 pb-4', scroll && 'overflow-y-auto', className)}>
        {children}
      </div>
    </div>
  );
}
