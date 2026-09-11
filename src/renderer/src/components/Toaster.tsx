import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useToasts } from '@renderer/store/toasts';
import { cn } from '@renderer/lib/utils';

const icons = { info: Info, success: CheckCircle2, warning: AlertTriangle, error: XCircle };

export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-3 bottom-14 z-50 flex flex-col gap-2">
      {toasts.map((t) => {
        const Icon = icons[t.kind];
        return (
          <div
            key={t.id}
            className={cn(
              'pointer-events-auto card-in flex items-start gap-2 rounded-md border bg-popover/95 p-2.5 text-xs shadow-lg backdrop-blur',
              t.kind === 'error' && 'border-destructive/50',
              t.kind === 'warning' && 'border-warning/50',
              t.kind === 'success' && 'border-success/50',
            )}
          >
            <Icon
              className={cn(
                'mt-0.5 size-4 shrink-0',
                t.kind === 'error' && 'text-destructive',
                t.kind === 'warning' && 'text-warning',
                t.kind === 'success' && 'text-success',
                t.kind === 'info' && 'text-primary',
              )}
            />
            <div className="min-w-0 flex-1">
              <div className="font-medium">{t.title}</div>
              {t.message && <div className="mt-0.5 text-muted-foreground selectable">{t.message}</div>}
            </div>
            <button className="opacity-60 hover:opacity-100" onClick={() => dismiss(t.id)}>
              <X className="size-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
