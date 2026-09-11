import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@renderer/components/ui/card';
import { Button } from '@renderer/components/ui/button';
import { Kbd } from '@renderer/components/ui/kbd';
import { useSettings } from '@renderer/store/settings';
import { prettyAccelerator, isMac } from '@renderer/lib/ipc';
import { DEFAULT_HOTKEYS, type HotkeyName } from '@shared/types/settings';
import { cn } from '@renderer/lib/utils';

const LABELS: Record<HotkeyName, { label: string; hint: string }> = {
  toggleListening: {
    label: 'Start / stop listening',
    hint: 'Toggles audio capture and transcription.',
  },
  answerNow: { label: 'Answer now', hint: 'Answers the last ~30 s of what the other party said.' },
  screenshotSolve: {
    label: 'Solve what’s on screen',
    hint: 'Captures a region and sends it to the strong model.',
  },
  togglePanel: { label: 'Show / hide panel', hint: '' },
  clearCards: { label: 'Clear answer cards', hint: '' },
};

/** Convert a KeyboardEvent to an Electron accelerator string. */
function eventToAccelerator(e: React.KeyboardEvent): string | null {
  const mods: string[] = [];
  if (e.metaKey || e.ctrlKey) mods.push('CommandOrControl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  const key = e.key;
  if (['Meta', 'Control', 'Alt', 'Shift'].includes(key)) return null;
  let k = key.length === 1 ? key.toUpperCase() : key;
  const map: Record<string, string> = {
    ' ': 'Space',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Escape: 'Esc',
  };
  k = map[k] ?? k;
  if (mods.length === 0 && !/^F\d{1,2}$/.test(k)) return null; // require a modifier unless F-key
  return [...mods, k].join('+');
}

export function HotkeySettings() {
  const hotkeys = useSettings((s) => s.settings.hotkeys);
  const update = useSettings((s) => s.update);
  const [recording, setRecording] = useState<HotkeyName | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Global hotkeys</CardTitle>
        <CardDescription>
          Work in any app, even while Zoom or Meet is focused. Click a binding and press the new
          combination.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {(Object.keys(LABELS) as HotkeyName[]).map((name) => (
          <div
            key={name}
            className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2"
          >
            <div className="min-w-0">
              <div className="text-sm">{LABELS[name].label}</div>
              {LABELS[name].hint && (
                <div className="text-[11px] text-muted-foreground">{LABELS[name].hint}</div>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                className={cn(
                  'no-drag rounded-md border px-2 py-1 font-mono text-xs transition-colors',
                  recording === name
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border hover:bg-accent',
                )}
                onClick={() => setRecording(name)}
                onBlur={() => setRecording(null)}
                onKeyDown={(e) => {
                  if (recording !== name) return;
                  e.preventDefault();
                  if (e.key === 'Escape') {
                    setRecording(null);
                    return;
                  }
                  const accel = eventToAccelerator(e);
                  if (!accel) return;
                  void update({ hotkeys: { [name]: accel } });
                  setRecording(null);
                }}
              >
                {recording === name ? 'Press keys…' : prettyAccelerator(hotkeys[name])}
              </button>
              {hotkeys[name] !== DEFAULT_HOTKEYS[name] && (
                <Button
                  size="iconSm"
                  variant="ghost"
                  title="Reset"
                  onClick={() => void update({ hotkeys: { [name]: DEFAULT_HOTKEYS[name] } })}
                >
                  <RotateCcw />
                </Button>
              )}
            </div>
          </div>
        ))}
        <p className="pt-1 text-[11px] text-muted-foreground">
          Tip: {isMac ? <Kbd>⌘⇧A</Kbd> : <Kbd>Ctrl+Shift+A</Kbd>} answers now, even before a
          question is auto-detected.
        </p>
      </CardContent>
    </Card>
  );
}
