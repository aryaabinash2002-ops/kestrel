import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { Textarea } from '@renderer/components/ui/textarea';
import { Label } from '@renderer/components/ui/label';
import type { Story } from '@shared/types/session';
import { uid } from '@shared/utils';

export function StoryBank({ stories, onChange }: { stories: Story[]; onChange: (s: Story[]) => void }) {
  const update = (id: string, patch: Partial<Story>) => onChange(stories.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>My stories (STAR bank)</Label>
        <Button size="xs" variant="outline" onClick={() => onChange([...stories, { id: uid('story'), title: '', text: '' }])} disabled={stories.length >= 12}>
          <Plus /> Add story
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Write 5–10 accomplishments once (situation, what you did, the result with a number). Behavioral answers pull from these — never from invented experience.
      </p>
      {stories.map((s, i) => (
        <div key={s.id} className="space-y-1.5 rounded-md border border-border/60 p-2">
          <div className="flex items-center gap-1.5">
            <span className="w-5 text-[10px] text-muted-foreground">{i + 1}.</span>
            <Input value={s.title} placeholder="Title, e.g. Billing migration under deadline" onChange={(e) => update(s.id, { title: e.target.value })} className="h-8 text-xs" />
            <Button size="iconSm" variant="ghost" onClick={() => onChange(stories.filter((x) => x.id !== s.id))} title="Remove">
              <Trash2 />
            </Button>
          </div>
          <Textarea rows={3} value={s.text} placeholder="Situation → Task → Action → Result (with metrics)" onChange={(e) => update(s.id, { text: e.target.value })} className="text-xs" />
        </div>
      ))}
    </div>
  );
}
