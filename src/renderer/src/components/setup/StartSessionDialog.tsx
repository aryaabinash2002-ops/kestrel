import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Radio, ShieldCheck } from 'lucide-react';
import { Button } from '@renderer/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@renderer/components/ui/dialog';
import { Select } from '@renderer/components/ui/select';
import { Label } from '@renderer/components/ui/label';
import { useProfiles } from '@renderer/store/profiles';
import { useSession } from '@renderer/store/session';
import { useAudio } from '@renderer/store/audio';
import { toast } from '@renderer/store/toasts';

/** Per-session start: pick a profile + the §11 consent checkbox, then start listening. */
export function StartSessionDialog({ open, onOpenChange, initialProfileId }: { open: boolean; onOpenChange: (o: boolean) => void; initialProfileId?: string | null }) {
  const profiles = useProfiles((s) => s.profiles);
  const startSession = useSession((s) => s.start);
  const startAudio = useAudio((s) => s.start);
  const navigate = useNavigate();
  const [profileId, setProfileId] = useState<string>(initialProfileId ?? profiles[0]?.id ?? '');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    try {
      await startSession(profileId || null);
      await startAudio();
      onOpenChange(false);
      navigate('/live');
    } catch (err) {
      toast({ kind: 'error', title: 'Could not start', message: String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle className="flex items-center gap-1.5">
          <Radio className="size-4 text-primary" /> Start a live session
        </DialogTitle>
        <DialogDescription>Kestrel will capture your microphone and the other party's audio, transcribe both, and suggest answers.</DialogDescription>
        <div className="space-y-1">
          <Label>Profile</Label>
          <Select options={[{ value: '', label: 'No profile (generic answers)' }, ...profiles.map((p) => ({ value: p.id, label: p.name }))]} value={profileId} onValueChange={setProfileId} />
        </div>
        <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-2.5 text-xs">
          <input type="checkbox" className="mt-0.5" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>
            <ShieldCheck className="mr-1 inline size-3.5 text-success" />
            Participants are aware of this recording/transcription, or this use is permitted by the platform and my local laws.
          </span>
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" disabled={!consent || busy} onClick={() => void start()}>
            Start listening
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
