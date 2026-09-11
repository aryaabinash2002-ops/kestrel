import { Headphones, Puzzle, VolumeX } from 'lucide-react';
import type { AudioState } from '@shared/types/audio';
import type { ExtensionState } from '@shared/types/extension';

/** Contextual, actionable hints for the most common "no audio" situations (§12 error states). */
export function AudioHints({ audio, extension }: { audio: AudioState | null; extension: ExtensionState | null }) {
  if (!audio?.listening) return null;
  const them = audio.them;
  const hints: { icon: React.ReactNode; text: string }[] = [];
  if (them.source === 'extension' && extension?.status !== 'capturing') {
    hints.push({
      icon: <Puzzle className="size-3.5" />,
      text: extension?.status === 'paired'
        ? 'Extension connected but not capturing — click the Kestrel icon on the Meet tab (or press Alt+Shift+K).'
        : 'Waiting for the Meet extension — open the Meet tab and click the Kestrel icon, or switch the capture method in Settings → Audio.',
    });
  } else if (them.active && them.warnings.includes('no-signal')) {
    hints.push({
      icon: <VolumeX className="size-3.5" />,
      text: `No audio from the other party yet. In your call app's audio settings, set the Speaker to the device Kestrel captures${them.deviceLabel ? ` (${them.deviceLabel})` : ''}.`,
    });
  }
  if (audio.me.active && them.active && !them.warnings.includes('no-signal') && audio.me.warnings.length === 0 && hints.length === 0) {
    return null;
  }
  if (audio.me.warnings.includes('bluetooth-headset')) {
    hints.push({ icon: <Headphones className="size-3.5" />, text: 'Bluetooth headset is in low-quality call mode — use the laptop mic or a wired headset for better transcripts.' });
  }
  if (hints.length === 0) return null;
  return (
    <div className="mx-3 mt-2 space-y-1">
      {hints.map((h, i) => (
        <div key={i} className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-2 py-1 text-[11px] text-warning">
          <span className="mt-0.5 shrink-0">{h.icon}</span>
          <span>{h.text}</span>
        </div>
      ))}
    </div>
  );
}
