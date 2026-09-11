import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Bird, Check, Mic, ShieldCheck, Volume2 } from 'lucide-react';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { Label } from '@renderer/components/ui/label';
import { useSettings } from '@renderer/store/settings';
import { invoke, isMac } from '@renderer/lib/ipc';
import { toast } from '@renderer/store/toasts';
import type { PermissionStatus } from '@shared/types/ipc';
import { cn } from '@renderer/lib/utils';

const steps = ['Welcome', 'Consent', 'Keys', 'Permissions'] as const;

export default function Onboarding() {
  const navigate = useNavigate();
  const update = useSettings((s) => s.update);
  const secrets = useSettings((s) => s.secrets);
  const refreshSecrets = useSettings((s) => s.refreshSecrets);
  const [step, setStep] = useState(0);
  const [consent, setConsent] = useState(false);
  const [anthropic, setAnthropic] = useState('');
  const [deepgram, setDeepgram] = useState('');
  const [perm, setPerm] = useState<PermissionStatus | null>(null);

  const refreshPerm = () => void invoke('app:permissions').then(setPerm);
  useEffect(() => {
    if (step === 3) {
      refreshPerm();
      const t = setInterval(refreshPerm, 2000);
      return () => clearInterval(t);
    }
    return undefined;
  }, [step]);

  const saveKeys = async () => {
    try {
      if (anthropic.trim()) await invoke('secrets:set', 'anthropic', anthropic);
      if (deepgram.trim()) await invoke('secrets:set', 'deepgram', deepgram);
      await refreshSecrets();
      setStep(3);
    } catch (err) {
      toast({ kind: 'error', title: 'Could not save keys', message: String(err) });
    }
  };

  const finish = async () => {
    await update({ onboardingDone: true, consentAcknowledged: true });
    navigate('/setup');
  };

  return (
    <div className="drag flex h-full flex-col bg-background">
      <div className={cn('flex h-10 items-center px-3', isMac && 'pl-[84px]')}>
        <span className="text-xs text-muted-foreground">
          Step {step + 1} of {steps.length}
        </span>
      </div>
      <div className="no-drag flex min-h-0 flex-1 flex-col justify-center px-6 pb-8">
        {step === 0 && (
          <div className="space-y-4">
            <Bird className="size-10 text-primary" />
            <h1 className="text-2xl font-semibold">Welcome to Kestrel</h1>
            <p className="text-sm text-muted-foreground">
              Your real-time copilot for interviews and calls. Kestrel listens to both sides of a conversation, spots questions as they’re asked and streams a concise, résumé-grounded answer into this panel within about a second.
            </p>
            <ul className="space-y-1.5 text-sm">
              <li className="flex gap-2"><Check className="mt-0.5 size-4 text-success" /> Works with Zoom, Google Meet, Teams, Webex or any audio.</li>
              <li className="flex gap-2"><Check className="mt-0.5 size-4 text-success" /> Practice mode with an AI interviewer and scoring.</li>
              <li className="flex gap-2"><Check className="mt-0.5 size-4 text-success" /> Everything stays on your computer. Bring your own API keys.</li>
            </ul>
            <Button onClick={() => setStep(1)}>
              Get started <ArrowRight />
            </Button>
          </div>
        )}
        {step === 1 && (
          <div className="space-y-4">
            <ShieldCheck className="size-10 text-primary" />
            <h1 className="text-xl font-semibold">Before you record anyone</h1>
            <p className="text-sm text-muted-foreground">
              Recording or transcribing a call may require the other participants’ consent depending on where you and they are located, and on the platform’s rules. You are responsible for complying with those laws and rules and with any interview policies you have agreed to.
            </p>
            <p className="text-sm text-muted-foreground">
              Kestrel is a normal window: it appears in screen shares and recordings like any other app, and it never types into other applications. A red <b>● Listening</b> indicator shows whenever audio is being captured.
            </p>
            <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-3 text-sm">
              <input type="checkbox" className="mt-0.5" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              I understand and will only use Kestrel where participants are aware or this use is permitted.
            </label>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setStep(0)}>Back</Button>
              <Button disabled={!consent} onClick={() => setStep(2)}>
                Continue <ArrowRight />
              </Button>
            </div>
          </div>
        )}
        {step === 2 && (
          <div className="space-y-4">
            <h1 className="text-xl font-semibold">Add your API keys</h1>
            <p className="text-sm text-muted-foreground">Stored in your OS keychain. You can change them any time in Settings → Keys.</p>
            <div className="space-y-1.5">
              <Label>Anthropic API key {secrets.anthropic && <span className="text-success">(stored)</span>}</Label>
              <Input type="password" placeholder="sk-ant-…" value={anthropic} onChange={(e) => setAnthropic(e.target.value)} autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label>Deepgram API key {secrets.deepgram && <span className="text-success">(stored)</span>}</Label>
              <Input type="password" placeholder="Deepgram key for live transcription" value={deepgram} onChange={(e) => setDeepgram(e.target.value)} autoComplete="off" />
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setStep(1)}>Back</Button>
              <Button onClick={() => void saveKeys()}>
                {anthropic || deepgram ? 'Save & continue' : 'Skip for now'} <ArrowRight />
              </Button>
            </div>
          </div>
        )}
        {step === 3 && (
          <div className="space-y-4">
            <h1 className="text-xl font-semibold">Permissions</h1>
            <PermRow
              icon={<Mic className="size-4" />}
              title="Microphone"
              status={perm?.microphone ?? 'unknown'}
              action={
                <Button size="sm" variant="outline" onClick={() => void invoke('app:requestMicPermission').then(refreshPerm)}>
                  Allow
                </Button>
              }
            />
            {isMac && (
              <PermRow
                icon={<Volume2 className="size-4" />}
                title="System audio recording"
                status={perm?.screen ?? 'unknown'}
                hint="macOS 14.2+: enable “System Audio Recording Only” for Kestrel (or for your terminal when running unpackaged) under Privacy & Security → Screen & System Audio Recording. Restart Kestrel afterwards."
                action={
                  <Button size="sm" variant="outline" onClick={() => void invoke('app:openPrivacySettings', 'audio')}>
                    Open settings
                  </Button>
                }
              />
            )}
            <p className="text-[11px] text-muted-foreground">You can also skip system audio entirely by using the Google Meet Chrome extension, which captures the call tab directly.</p>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setStep(2)}>Back</Button>
              <Button onClick={() => void finish()}>
                Finish <Check />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PermRow({ icon, title, status, hint, action }: { icon: React.ReactNode; title: string; status: string; hint?: string; action: React.ReactNode }) {
  const ok = status === 'granted';
  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-sm font-medium">{title}</span>
        <span className={cn('ml-auto text-xs', ok ? 'text-success' : 'text-warning')}>{status}</span>
        {!ok && action}
      </div>
      {hint && <p className="mt-1.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
