import { useEffect, useState } from 'react';
import { Copy, FolderOpen, Puzzle, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@renderer/components/ui/card';
import { Button } from '@renderer/components/ui/button';
import { Badge } from '@renderer/components/ui/badge';
import { invoke } from '@renderer/lib/ipc';
import { useAudio } from '@renderer/store/audio';
import type { ExtensionPairingInfo } from '@shared/types/extension';
import { toast } from '@renderer/store/toasts';
import { Switch } from '@renderer/components/ui/switch';
import { useSettings } from '@renderer/store/settings';

export function ExtensionCard() {
  const ext = useAudio((s) => s.extension);
  const autoStart = useSettings((s) => s.settings.autoStartOnMeetJoin);
  const update = useSettings((s) => s.update);
  const [pairing, setPairing] = useState<ExtensionPairingInfo | null>(null);
  const load = () => void invoke('extension:pairing').then(setPairing).catch(() => setPairing(null));
  useEffect(load, []);

  const status = ext?.status ?? 'off';
  const badge =
    status === 'capturing' ? <Badge variant="them">Capturing Meet audio</Badge>
    : status === 'paired' ? <Badge variant="success">Connected</Badge>
    : status === 'listening' ? <Badge variant="secondary">Waiting for extension</Badge>
    : <Badge variant="secondary">Off</Badge>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          <Puzzle className="size-4" /> Google Meet extension
          <span className="ml-auto">{badge}</span>
        </CardTitle>
        <CardDescription>
          Captures only the Meet tab’s audio (no notifications or music) and reads Meet captions as a backup. Works in Chrome, Edge, Brave and Arc.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-xs">
        <ol className="list-decimal space-y-1 pl-4 text-muted-foreground">
          <li>Open <code>chrome://extensions</code>, enable Developer mode, click <b>Load unpacked</b> and choose the extension folder.</li>
          <li>Open the Kestrel extension popup and paste the pairing token below.</li>
          <li>Join a Meet call — capture starts automatically when a session is running.</li>
        </ol>
        {pairing && (
          <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/40 p-2 font-mono">
            <span className="truncate selectable">{pairing.token}</span>
            <span className="ml-auto text-muted-foreground">:{pairing.port}</span>
            <Button
              size="iconSm"
              variant="ghost"
              title="Copy token"
              onClick={() => {
                void navigator.clipboard.writeText(pairing.token);
                toast({ kind: 'success', title: 'Pairing token copied' });
              }}
            >
              <Copy />
            </Button>
          </div>
        )}
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => void invoke('extension:openFolder')}>
            <FolderOpen /> Extension folder
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void invoke('extension:regenerateToken').then(setPairing)}>
            <RefreshCw /> New token
          </Button>
        </div>
        {ext?.clientName && (
          <div className="text-muted-foreground">
            Client: {ext.clientName} · {ext.inCall ? 'in a call' : 'not in a call'} · captions {ext.captionsAvailable ? 'available' : 'off'}
          </div>
        )}
        <div className="flex items-center justify-between gap-3 pt-1">
          <div>
            <div className="text-sm">Auto-start when I join a Meet call</div>
            <div className="text-[11px] text-muted-foreground">Starts a session and listening on join; ends it and opens the review when you leave.</div>
          </div>
          <Switch checked={autoStart} onCheckedChange={(v) => void update({ autoStartOnMeetJoin: v })} />
        </div>
      </CardContent>
    </Card>
  );
}
