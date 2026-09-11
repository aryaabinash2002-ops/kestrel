import { useState } from 'react';
import { Save, Trash2 } from 'lucide-react';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { Label } from '@renderer/components/ui/label';
import { Select } from '@renderer/components/ui/select';
import { Textarea } from '@renderer/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card';
import type { Profile, Story } from '@shared/types/session';
import { useProfiles } from '@renderer/store/profiles';
import { useSettings } from '@renderer/store/settings';
import { toast } from '@renderer/store/toasts';
import { DocumentField } from './DocumentField';
import { StoryBank } from './StoryBank';

type Draft = Omit<Profile, 'id' | 'createdAt' | 'updatedAt'> & { id?: string };

const TYPES = [
  { value: 'behavioral', label: 'Behavioral interview' },
  { value: 'technical', label: 'Technical interview' },
  { value: 'system_design', label: 'System design interview' },
  { value: 'sales', label: 'Sales / discovery call' },
  { value: 'general', label: 'General meeting' },
];

export function ProfileForm({
  profile,
  onDone,
}: {
  profile: Profile | null;
  onDone: (saved: Profile | null) => void;
}) {
  const defaults = useSettings((s) => s.settings.defaults);
  const save = useProfiles((s) => s.save);
  const remove = useProfiles((s) => s.remove);
  const [d, setD] = useState<Draft>(() => toDraft(profile, defaults));
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((prev) => ({ ...prev, [k]: v }));

  const submit = async () => {
    if (!d.name.trim()) {
      toast({ kind: 'warning', title: 'Give the profile a name' });
      return;
    }
    setBusy(true);
    try {
      const saved = await save({
        ...d,
        stories: d.stories.filter((s: Story) => s.title.trim() || s.text.trim()),
      });
      toast({ kind: 'success', title: 'Profile saved' });
      onDone(saved);
    } catch (err) {
      toast({ kind: 'error', title: 'Could not save', message: String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{profile ? 'Edit profile' : 'New session profile'}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1">
            <Label>Profile name</Label>
            <Input
              value={d.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="e.g. Acme — Senior Engineer"
            />
          </div>
          <div className="space-y-1">
            <Label>Your name</Label>
            <Input
              value={d.userName}
              onChange={(e) => set('userName', e.target.value)}
              placeholder="Jane"
            />
          </div>
          <div className="space-y-1">
            <Label>Conversation type</Label>
            <Select
              options={TYPES}
              value={d.type}
              onValueChange={(v) => set('type', v as Profile['type'])}
            />
          </div>
          <div className="space-y-1">
            <Label>Role</Label>
            <Input
              value={d.role}
              onChange={(e) => set('role', e.target.value)}
              placeholder="Senior Software Engineer"
            />
          </div>
          <div className="space-y-1">
            <Label>Company</Label>
            <Input
              value={d.company}
              onChange={(e) => set('company', e.target.value)}
              placeholder="Acme"
            />
          </div>
          <div className="space-y-1">
            <Label>Answer language</Label>
            <Input value={d.language} onChange={(e) => set('language', e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Answer length</Label>
            <Select
              options={[
                { value: 'short', label: 'Short' },
                { value: 'medium', label: 'Medium' },
                { value: 'detailed', label: 'Detailed' },
              ]}
              value={d.length}
              onValueChange={(v) => set('length', v as Profile['length'])}
            />
          </div>
          <div className="space-y-1">
            <Label>Tone</Label>
            <Select
              options={[
                { value: 'confident', label: 'Confident' },
                { value: 'casual', label: 'Casual' },
                { value: 'formal', label: 'Formal' },
              ]}
              value={d.tone}
              onValueChange={(v) => set('tone', v as Profile['tone'])}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Grounding</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <DocumentField
            label="Résumé"
            value={d.resumeText}
            onChange={(v) => set('resumeText', v)}
            hint="Paste your résumé or import a PDF/DOCX. Answers only use facts from here."
          />
          <DocumentField
            label="Job description"
            value={d.jdText}
            onChange={(v) => set('jdText', v)}
            rows={5}
            hint="Paste the JD (or import). Used to tailor answers and generate practice questions."
          />
          <StoryBank stories={d.stories} onChange={(s) => set('stories', s)} />
          <div className="space-y-1">
            <Label>Notes</Label>
            <Textarea
              rows={3}
              value={d.notes}
              onChange={(e) => set('notes', e.target.value)}
              placeholder="Anything the assistant should know: what to emphasise, topics to avoid, salary range, availability…"
              className="text-xs"
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-2">
        <Button onClick={() => void submit()} disabled={busy}>
          <Save /> Save profile
        </Button>
        <Button variant="ghost" onClick={() => onDone(null)}>
          Cancel
        </Button>
        {profile && (
          <Button
            variant="ghost"
            className="ml-auto text-destructive"
            onClick={async () => {
              await remove(profile.id);
              onDone(null);
            }}
          >
            <Trash2 /> Delete
          </Button>
        )}
      </div>
    </div>
  );
}

function toDraft(
  p: Profile | null,
  defaults: { length: Profile['length']; tone: Profile['tone']; language: string },
): Draft {
  return {
    id: p?.id,
    name: p?.name ?? '',
    role: p?.role ?? '',
    company: p?.company ?? '',
    type: p?.type ?? 'behavioral',
    language: p?.language ?? defaults.language,
    length: p?.length ?? defaults.length,
    tone: p?.tone ?? defaults.tone,
    resumeText: p?.resumeText ?? '',
    jdText: p?.jdText ?? '',
    stories: p?.stories ?? [],
    notes: p?.notes ?? '',
    userName: p?.userName ?? '',
  };
}
