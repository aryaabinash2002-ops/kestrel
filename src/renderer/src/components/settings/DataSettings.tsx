import { useState } from 'react';
import { FolderOpen, Trash2 } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@renderer/components/ui/card';
import { Button } from '@renderer/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@renderer/components/ui/dialog';
import { useSettings } from '@renderer/store/settings';
import { invoke } from '@renderer/lib/ipc';
import { useSession } from '@renderer/store/session';

export function DataSettings() {
  const appInfo = useSettings((s) => s.appInfo);
  const load = useSettings((s) => s.load);
  const [confirm, setConfirm] = useState(false);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Data folder</CardTitle>
          <CardDescription>
            Everything Kestrel stores lives here: the SQLite database, résumés, screenshots and
            exports. Nothing is sent to any server other than the AI providers you configured.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="break-all rounded-md border border-border/60 bg-muted/40 p-2 font-mono text-[11px] selectable">
            {appInfo?.dataDir}
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => appInfo && void invoke('app:openPath', appInfo.dataDir)}
            >
              <FolderOpen /> Open folder
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void invoke('app:chooseDataDir').then(() => load())}
            >
              Change…
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-destructive">Delete all data</CardTitle>
          <CardDescription>
            Removes every profile, session, transcript, answer, screenshot and API key. This cannot
            be undone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button size="sm" variant="destructive" onClick={() => setConfirm(true)}>
            <Trash2 /> Delete everything
          </Button>
        </CardContent>
      </Card>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogTitle>Delete all Kestrel data?</DialogTitle>
          <DialogDescription>
            Profiles, sessions, transcripts, answers, screenshots and stored API keys will be
            permanently removed.
          </DialogDescription>
          <div className="flex justify-end gap-2 pt-2">
            <Button size="sm" variant="outline" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={async () => {
                await invoke('app:deleteAllData');
                setConfirm(false);
                await load();
                await useSession.getState().refresh();
              }}
            >
              Delete everything
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <p className="text-[11px] text-muted-foreground">
        Kestrel {appInfo?.version} · Electron {appInfo?.electron} · {appInfo?.platform}{' '}
        {appInfo?.arch}
      </p>
    </div>
  );
}
