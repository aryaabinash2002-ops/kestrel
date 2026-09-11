import { Loader2, WifiOff } from 'lucide-react';
import type { TranscriptionState } from '@shared/types/transcription';
import { cn } from '@renderer/lib/utils';

export function TranscriptionStatus({ states, listening }: { states: Record<'ME' | 'THEM', TranscriptionState | null>; listening: boolean }) {
  const items = [states.ME, states.THEM].filter((s): s is TranscriptionState => !!s);
  const bad = items.filter((s) => s.status === 'reconnecting' || s.status === 'error' || s.status === 'connecting');
  if (!listening || bad.length === 0) return null;
  const err = bad.find((s) => s.status === 'error');
  const reconnecting = bad.find((s) => s.status === 'reconnecting');
  const label = err
    ? `Transcription error: ${err.message ?? 'unknown'}`
    : reconnecting
      ? `Reconnecting to ${reconnecting.provider}${reconnecting.reconnectAttempt ? ` (attempt ${reconnecting.reconnectAttempt})` : ''}…`
      : `Connecting to ${bad[0]?.provider}…`;
  return (
    <div className={cn('mx-3 mt-2 flex items-center gap-2 rounded-md border px-2 py-1 text-[11px]', err ? 'border-destructive/50 bg-destructive/10 text-destructive' : 'border-warning/50 bg-warning/10 text-warning')}>
      {err ? <WifiOff className="size-3.5" /> : <Loader2 className="size-3.5 animate-spin" />}
      {label}
    </div>
  );
}
