import { useEffect, useState } from 'react';
import { GraduationCap, Play, Volume2 } from 'lucide-react';
import { Button } from '@renderer/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@renderer/components/ui/card';
import { Label } from '@renderer/components/ui/label';
import { Select } from '@renderer/components/ui/select';
import { Switch } from '@renderer/components/ui/switch';
import { useProfiles } from '@renderer/store/profiles';
import { useSettings } from '@renderer/store/settings';
import { usePractice } from '@renderer/store/practice';
import { toast } from '@renderer/store/toasts';
import { ttsAvailable } from './tts';

export function PracticeSetup() {
  const profiles = useProfiles((s) => s.profiles);
  const loadProfiles = useProfiles((s) => s.load);
  const lastProfileId = useSettings((s) => s.settings.lastProfileId);
  const hasAnthropic = useSettings((s) => s.secrets.anthropic);
  const sets = usePractice((s) => s.sets);
  const loadSets = usePractice((s) => s.loadSets);
  const start = usePractice((s) => s.start);
  const phase = usePractice((s) => s.phase);
  const [profileId, setProfileId] = useState<string>(lastProfileId ?? '');
  const [setId, setSetId] = useState('behavioral');
  const [count, setCount] = useState('5');
  const [useTts, setUseTts] = useState(true);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);
  useEffect(() => {
    void loadSets(profileId || null);
  }, [profileId, loadSets]);

  const begin = async () => {
    try {
      await start({
        profileId: profileId || null,
        setId,
        count: Number(count),
        useTts: useTts && ttsAvailable(),
      });
    } catch (err) {
      toast({ kind: 'error', title: 'Could not start practice', message: String(err) });
    }
  };

  const selectedSet = sets.find((s) => s.id === setId);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          <GraduationCap className="size-4 text-primary" /> Mock interview
        </CardTitle>
        <CardDescription>
          An AI interviewer asks questions out loud, listens to your spoken answer and scores it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <Label>Profile</Label>
          <Select
            options={[
              { value: '', label: 'No profile (generic questions)' },
              ...profiles.map((p) => ({ value: p.id, label: p.name })),
            ]}
            value={profileId}
            onValueChange={setProfileId}
          />
        </div>
        <div className="space-y-1">
          <Label>Question set</Label>
          <Select
            options={sets.map((s) => ({ value: s.id, label: s.label }))}
            value={setId}
            onValueChange={setSetId}
          />
          {selectedSet && (
            <p className="text-[11px] text-muted-foreground">{selectedSet.description}</p>
          )}
        </div>
        <div className="grid grid-cols-2 items-end gap-3">
          <div className="space-y-1">
            <Label>Questions</Label>
            <Select
              options={[
                { value: '3', label: '3 questions (quick)' },
                { value: '5', label: '5 questions' },
                { value: '10', label: '10 questions' },
              ]}
              value={count}
              onValueChange={setCount}
            />
          </div>
          <div className="flex items-center justify-between rounded-md border border-border/60 px-2.5 py-2">
            <span className="flex items-center gap-1.5 text-sm">
              <Volume2 className="size-3.5" /> Read aloud
            </span>
            <Switch
              checked={useTts && ttsAvailable()}
              disabled={!ttsAvailable()}
              onCheckedChange={setUseTts}
            />
          </div>
        </div>
        {!hasAnthropic && (
          <p className="text-[11px] text-warning">
            No Anthropic API key stored — scoring and role-specific questions need one (Settings →
            Keys).
          </p>
        )}
        <Button onClick={() => void begin()} disabled={phase === 'starting'}>
          <Play /> {phase === 'starting' ? 'Starting…' : 'Start practice'}
        </Button>
      </CardContent>
    </Card>
  );
}
