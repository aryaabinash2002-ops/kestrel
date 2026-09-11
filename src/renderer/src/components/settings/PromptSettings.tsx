import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@renderer/components/ui/card';
import { Button } from '@renderer/components/ui/button';
import { Select } from '@renderer/components/ui/select';
import { Textarea } from '@renderer/components/ui/textarea';
import { useSettings } from '@renderer/store/settings';
import { invoke } from '@renderer/lib/ipc';
import { toast } from '@renderer/store/toasts';
import type { PromptName } from '@shared/types/settings';

const NAMES: { value: PromptName; label: string }[] = [
  { value: 'live_answer', label: 'Live answer (system prompt)' },
  { value: 'classifier', label: 'Question classifier' },
  { value: 'screenshot_solve', label: 'Screenshot solve' },
  { value: 'practice_interviewer', label: 'Practice interviewer' },
  { value: 'practice_scorer', label: 'Practice scorer' },
  { value: 'review', label: 'Post-session review' },
  { value: 'summary', label: 'Running summary' },
];

export function PromptSettings() {
  const overrides = useSettings((s) => s.settings.prompts);
  const update = useSettings((s) => s.update);
  const [name, setName] = useState<PromptName>('live_answer');
  const [defaultText, setDefaultText] = useState('');
  const [text, setText] = useState('');

  useEffect(() => {
    void invoke('settings:defaultPrompt', name).then((d) => {
      setDefaultText(d);
      setText(overrides[name] ?? d);
    });
  }, [name, overrides]);

  const dirty = text !== (overrides[name] ?? defaultText);
  const isOverridden = overrides[name] !== undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Prompts</CardTitle>
        <CardDescription>
          Edit the templates the model receives. Variables in braces like <code>{'{role}'}</code> are filled in per session; <code>{'{if behavioral}…{/if}'}</code> blocks are conditional.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Select options={NAMES} value={name} onValueChange={(v) => setName(v as PromptName)} />
        <Textarea className="min-h-[260px] font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            disabled={!dirty}
            onClick={() => {
              void update({ prompts: { [name]: text } });
              toast({ kind: 'success', title: 'Prompt saved' });
            }}
          >
            Save
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!isOverridden}
            onClick={() => {
              void invoke('settings:resetPrompt', name);
              setText(defaultText);
            }}
          >
            Reset to default
          </Button>
          {isOverridden && <span className="text-[11px] text-muted-foreground">Customised</span>}
        </div>
      </CardContent>
    </Card>
  );
}
