import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Eye, EyeOff, KeyRound, Trash2 } from 'lucide-react';
import { Page } from '@renderer/components/Page';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { Label } from '@renderer/components/ui/label';
import { Select } from '@renderer/components/ui/select';
import { Switch } from '@renderer/components/ui/switch';
import { Slider } from '@renderer/components/ui/slider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@renderer/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@renderer/components/ui/card';
import { Badge } from '@renderer/components/ui/badge';
import { useSettings } from '@renderer/store/settings';
import { toast } from '@renderer/store/toasts';
import { invoke } from '@renderer/lib/ipc';
import type { SecretKey } from '@shared/types/settings';
import { HotkeySettings } from '@renderer/components/settings/HotkeySettings';
import { AudioSettings } from '@renderer/components/settings/AudioSettings';
import { PromptSettings } from '@renderer/components/settings/PromptSettings';
import { Diagnostics } from '@renderer/components/settings/Diagnostics';
import { DataSettings } from '@renderer/components/settings/DataSettings';

const MODEL_OPTIONS = [
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (fastest)' },
  { value: 'claude-sonnet-5', label: 'Claude Sonnet 5 (strong)' },
  { value: 'claude-opus-5', label: 'Claude Opus 5 (strongest)' },
];

function SecretField({ id, label, hint, testable }: { id: SecretKey; label: string; hint: string; testable?: boolean }) {
  const has = useSettings((s) => s.secrets[id]);
  const refresh = useSettings((s) => s.refreshSecrets);
  const [value, setValue] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!value.trim()) return;
    setBusy(true);
    try {
      await invoke('secrets:set', id, value);
      setValue('');
      await refresh();
      toast({ kind: 'success', title: `${label} saved to keychain` });
    } catch (err) {
      toast({ kind: 'error', title: `Could not save ${label}`, message: String(err) });
    } finally {
      setBusy(false);
    }
  };
  const test = async () => {
    setBusy(true);
    try {
      const r = await invoke('secrets:test', id);
      toast({ kind: r.ok ? 'success' : 'error', title: r.ok ? `${label} works` : `${label} failed`, message: r.message });
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    await invoke('secrets:delete', id);
    await refresh();
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label htmlFor={`secret-${id}`}>{label}</Label>
        {has ? <Badge variant="success">Stored</Badge> : <Badge variant="secondary">Not set</Badge>}
      </div>
      <div className="flex gap-1.5">
        <div className="relative flex-1">
          <Input
            id={`secret-${id}`}
            type={show ? 'text' : 'password'}
            placeholder={has ? '•••••••••••• (enter a new key to replace)' : 'Paste API key'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void save()}
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            onClick={() => setShow((v) => !v)}
            tabIndex={-1}
          >
            {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        <Button size="sm" onClick={() => void save()} disabled={!value.trim() || busy}>
          Save
        </Button>
        {testable && has && (
          <Button size="sm" variant="outline" onClick={() => void test()} disabled={busy}>
            Test
          </Button>
        )}
        {has && (
          <Button size="iconSm" variant="ghost" onClick={() => void remove()} title="Remove key">
            <Trash2 />
          </Button>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}

export default function Settings() {
  const { tab } = useParams();
  const navigate = useNavigate();
  const settings = useSettings((s) => s.settings);
  const update = useSettings((s) => s.update);
  const backend = useSettings((s) => s.secretBackend);
  const [opacity, setOpacity] = useState(settings.ui.opacity);
  useEffect(() => setOpacity(settings.ui.opacity), [settings.ui.opacity]);

  return (
    <Page title="Settings" scroll={false}>
      <Tabs value={tab ?? 'keys'} onValueChange={(v) => navigate(`/settings/${v}`)} className="flex h-full flex-col">
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="keys">Keys</TabsTrigger>
          <TabsTrigger value="audio">Audio</TabsTrigger>
          <TabsTrigger value="answers">Answers</TabsTrigger>
          <TabsTrigger value="hotkeys">Hotkeys</TabsTrigger>
          <TabsTrigger value="appearance">Look</TabsTrigger>
          <TabsTrigger value="prompts">Prompts</TabsTrigger>
          <TabsTrigger value="diagnostics">Diag</TabsTrigger>
          <TabsTrigger value="data">Data</TabsTrigger>
        </TabsList>
        <div className="min-h-0 flex-1 overflow-y-auto pb-2">
          <TabsContent value="keys" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5">
                  <KeyRound className="size-4" /> API keys
                </CardTitle>
                <CardDescription>
                  Bring your own keys. They are stored in your OS {backend === 'keychain' ? 'keychain' : backend === 'safeStorage' ? 'encrypted storage' : 'memory only (no secure storage available)'} and never written to plain-text files or logs.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <SecretField id="anthropic" label="Anthropic API key" hint="console.anthropic.com → API keys. Powers answers, reviews and practice scoring." testable />
                <SecretField id="deepgram" label="Deepgram API key" hint="console.deepgram.com. Default streaming transcription provider." testable />
                <SecretField id="assemblyai" label="AssemblyAI API key" hint="assemblyai.com. Optional alternative transcription provider." testable />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Models</CardTitle>
                <CardDescription>Fast model for live answers; stronger model for screenshots, coding and reviews.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1">
                  <Label>Live answers (fast)</Label>
                  <Select options={MODEL_OPTIONS} value={settings.models.live} onValueChange={(v) => void update({ models: { live: v } })} />
                </div>
                <div className="space-y-1">
                  <Label>Screenshots, coding &amp; review (strong)</Label>
                  <Select options={MODEL_OPTIONS} value={settings.models.heavy} onValueChange={(v) => void update({ models: { heavy: v } })} />
                </div>
                <div className="space-y-1">
                  <Label>Question classifier &amp; summaries</Label>
                  <Select options={MODEL_OPTIONS} value={settings.models.classifier} onValueChange={(v) => void update({ models: { classifier: v } })} />
                </div>
                <div className="space-y-1">
                  <Label>Transcription provider</Label>
                  <Select
                    options={[
                      { value: 'deepgram', label: 'Deepgram Nova-3 (recommended)' },
                      { value: 'assemblyai', label: 'AssemblyAI Universal Streaming' },
                    ]}
                    value={settings.transcriber}
                    onValueChange={(v) => void update({ transcriber: v as 'deepgram' | 'assemblyai' })}
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="audio">
            <AudioSettings />
          </TabsContent>

          <TabsContent value="answers" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Answering behaviour</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Row label="Auto-answer detected questions" hint="Start an answer the moment a question is detected, no hotkey needed.">
                  <Switch checked={settings.autoAnswer} onCheckedChange={(v) => void update({ autoAnswer: v })} />
                </Row>
                <Row label="Answer smalltalk" hint="Off: smalltalk shows a small chip you can click instead of a full answer.">
                  <Switch checked={settings.smalltalkAnswers} onCheckedChange={(v) => void update({ smalltalkAnswers: v })} />
                </Row>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Default length</Label>
                    <Select
                      options={[
                        { value: 'short', label: 'Short' },
                        { value: 'medium', label: 'Medium' },
                        { value: 'detailed', label: 'Detailed' },
                      ]}
                      value={settings.defaults.length}
                      onValueChange={(v) => void update({ defaults: { length: v as 'short' | 'medium' | 'detailed' } })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Default tone</Label>
                    <Select
                      options={[
                        { value: 'confident', label: 'Confident' },
                        { value: 'casual', label: 'Casual' },
                        { value: 'formal', label: 'Formal' },
                      ]}
                      value={settings.defaults.tone}
                      onValueChange={(v) => void update({ defaults: { tone: v as 'confident' | 'casual' | 'formal' } })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Answer language</Label>
                    <Input value={settings.defaults.language} onChange={(e) => void update({ defaults: { language: e.target.value } })} />
                  </div>
                  <div className="space-y-1">
                    <Label>Code language</Label>
                    <Input value={settings.defaults.codeLanguage} onChange={(e) => void update({ defaults: { codeLanguage: e.target.value } })} />
                  </div>
                  <div className="col-span-2 space-y-1">
                    <Label>Transcription language</Label>
                    <Select
                      options={[
                        { value: 'multi', label: 'Auto-detect / multilingual' },
                        { value: 'en', label: 'English' },
                        { value: 'en-US', label: 'English (US)' },
                        { value: 'en-GB', label: 'English (UK)' },
                        { value: 'en-IN', label: 'English (India)' },
                        { value: 'hi', label: 'Hindi' },
                        { value: 'es', label: 'Spanish' },
                        { value: 'fr', label: 'French' },
                        { value: 'de', label: 'German' },
                        { value: 'pt', label: 'Portuguese' },
                        { value: 'ar', label: 'Arabic' },
                        { value: 'ja', label: 'Japanese' },
                        { value: 'zh', label: 'Chinese' },
                      ]}
                      value={settings.transcriptionLanguage}
                      onValueChange={(v) => void update({ transcriptionLanguage: v })}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="hotkeys">
            <HotkeySettings />
          </TabsContent>

          <TabsContent value="appearance" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Panel</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Row label="Always on top">
                  <Switch checked={settings.ui.alwaysOnTop} onCheckedChange={(v) => void update({ ui: { alwaysOnTop: v } })} />
                </Row>
                <Row label="Compact layout">
                  <Switch checked={settings.ui.compact} onCheckedChange={(v) => void invoke('window:setCompact', v)} />
                </Row>
                <Row label="Show latency on cards" hint="Developer view: milliseconds from the interviewer's last word to first token.">
                  <Switch checked={settings.ui.showLatency} onCheckedChange={(v) => void update({ ui: { showLatency: v } })} />
                </Row>
                <div className="space-y-1.5">
                  <div className="flex justify-between">
                    <Label>Opacity</Label>
                    <span className="text-xs text-muted-foreground">{Math.round(opacity * 100)}%</span>
                  </div>
                  <Slider
                    min={0.3}
                    max={1}
                    step={0.05}
                    value={[opacity]}
                    onValueChange={([v]) => {
                      if (v !== undefined) setOpacity(v);
                    }}
                    onValueCommit={([v]) => v !== undefined && void update({ ui: { opacity: v } })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Theme</Label>
                    <Select
                      options={[
                        { value: 'dark', label: 'Dark' },
                        { value: 'light', label: 'Light' },
                        { value: 'system', label: 'System' },
                      ]}
                      value={settings.ui.theme}
                      onValueChange={(v) => void update({ ui: { theme: v as 'dark' | 'light' | 'system' } })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Font size</Label>
                    <Select
                      options={[12, 13, 14, 15, 16, 18].map((n) => ({ value: String(n), label: `${n}px` }))}
                      value={String(settings.ui.fontSize)}
                      onValueChange={(v) => void update({ ui: { fontSize: Number(v) } })}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="prompts">
            <PromptSettings />
          </TabsContent>

          <TabsContent value="diagnostics">
            <Diagnostics />
          </TabsContent>

          <TabsContent value="data">
            <DataSettings />
          </TabsContent>
        </div>
      </Tabs>
    </Page>
  );
}

export function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-sm">{label}</div>
        {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
