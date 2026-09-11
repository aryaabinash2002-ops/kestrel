import { useEffect } from 'react';
import { Headphones, RefreshCw } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@renderer/components/ui/card';
import { Button } from '@renderer/components/ui/button';
import { Label } from '@renderer/components/ui/label';
import { Select } from '@renderer/components/ui/select';
import { Progress } from '@renderer/components/ui/progress';
import { Badge } from '@renderer/components/ui/badge';
import { useSettings } from '@renderer/store/settings';
import { useAudio } from '@renderer/store/audio';
import { isMac } from '@renderer/lib/ipc';
import { ExtensionCard } from '@renderer/components/ExtensionCard';

export function AudioSettings() {
  const settings = useSettings((s) => s.settings);
  const update = useSettings((s) => s.update);
  const appInfo = useSettings((s) => s.appInfo);
  const devices = useAudio((s) => s.devices);
  const levels = useAudio((s) => s.levels);
  const state = useAudio((s) => s.state);
  const refreshDevices = useAudio((s) => s.refreshDevices);

  useEffect(() => {
    void refreshDevices();
  }, [refreshDevices]);

  const inputOptions = [
    { value: '', label: 'System default microphone' },
    ...devices.inputs.map((d) => ({ value: d.deviceId, label: d.label || 'Microphone' })),
  ];
  const virtualInputs = devices.inputs.filter((d) =>
    /blackhole|soundflower|loopback|vb-?audio|cable|virtual/i.test(d.label),
  );

  const modeOptions = [
    { value: 'auto', label: 'Auto (extension when connected, else system audio)' },
    { value: 'extension', label: 'Chrome extension (Google Meet)' },
    { value: 'loopback', label: 'System audio (Zoom, Teams, any browser)' },
    { value: 'device', label: 'Virtual audio device (BlackHole / VB-Cable)' },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>
            Microphone — <span className="text-me">ME</span>
          </CardTitle>
          <CardDescription>
            Your own voice. Echo cancellation, noise suppression and auto gain are always on.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1">
              <Label>Input device</Label>
              <Select
                options={inputOptions}
                value={settings.audio.micDeviceId ?? ''}
                onValueChange={(v) => void update({ audio: { micDeviceId: v || null } })}
              />
            </div>
            <Button
              size="icon"
              variant="outline"
              onClick={() => void refreshDevices()}
              title="Refresh devices"
            >
              <RefreshCw />
            </Button>
          </div>
          <LevelRow
            label="Mic level"
            level={levels.ME}
            tone="me"
            active={state?.me.active ?? false}
            warnings={state?.me.warnings ?? []}
            error={state?.me.error ?? null}
          />
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Headphones className="size-3.5" /> Headphones recommended: on speakers the mic also
            hears the other party. Kestrel drops duplicated speech, but headphones give cleaner
            transcripts.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            Other party — <span className="text-them">THEM</span>
          </CardTitle>
          <CardDescription>What you hear: the interviewer, client or customer.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label>Capture method</Label>
            <Select
              options={modeOptions}
              value={settings.audio.systemAudioMode}
              onValueChange={(v) =>
                void update({
                  audio: { systemAudioMode: v as typeof settings.audio.systemAudioMode },
                })
              }
            />
          </div>
          {(settings.audio.systemAudioMode === 'device' || virtualInputs.length > 0) && (
            <div className="space-y-1">
              <Label>Virtual input device</Label>
              <Select
                options={[
                  { value: '', label: 'Choose…' },
                  ...devices.inputs.map((d) => ({ value: d.deviceId, label: d.label || 'Input' })),
                ]}
                value={settings.audio.systemInputDeviceId ?? ''}
                onValueChange={(v) => void update({ audio: { systemInputDeviceId: v || null } })}
              />
            </div>
          )}
          <LevelRow
            label="System level"
            level={levels.THEM}
            tone="them"
            active={state?.them.active ?? false}
            warnings={state?.them.warnings ?? []}
            error={state?.them.error ?? null}
          />
          <div className="rounded-md border border-border/60 bg-muted/30 p-2.5 text-[11px] text-muted-foreground">
            {state?.them.deviceLabel && (
              <div className="mb-1">
                Capturing output device:{' '}
                <span className="font-medium text-foreground">{state.them.deviceLabel}</span>
              </div>
            )}
            <div>
              In Google Meet → Settings → Audio, the <b>Speaker</b> device must match the device
              Kestrel is capturing. Zoom and Teams: same rule under their audio settings.
            </div>
            {isMac && (
              <div className="mt-1">
                macOS {appInfo?.macOSVersion ?? ''}: system audio capture needs the{' '}
                <b>System Audio Recording</b> (Screen &amp; System Audio Recording) permission in
                Privacy &amp; Security. When running unpackaged from a terminal, that terminal must
                be granted instead. If levels stay at zero, install{' '}
                <a
                  className="underline"
                  href="https://existential.audio/blackhole/"
                  target="_blank"
                  rel="noreferrer"
                >
                  BlackHole
                </a>{' '}
                and pick it as a virtual input device.
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <ExtensionCard />
    </div>
  );
}

function LevelRow({
  label,
  level,
  tone,
  active,
  warnings,
  error,
}: {
  label: string;
  level: number;
  tone: 'me' | 'them';
  active: boolean;
  warnings: string[];
  error: string | null;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="flex items-center gap-1">
          {error ? (
            <Badge variant="destructive">{error}</Badge>
          ) : active ? (
            <Badge variant={tone}>Live</Badge>
          ) : (
            <Badge variant="secondary">Idle</Badge>
          )}
          {warnings.map((w) => (
            <Badge key={w} variant="warning">
              {w}
            </Badge>
          ))}
        </span>
      </div>
      <Progress value={level} tone={tone} />
    </div>
  );
}
