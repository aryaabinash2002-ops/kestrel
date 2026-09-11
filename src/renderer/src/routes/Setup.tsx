import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Briefcase, FileText, FlaskConical, Play, Plus, Sparkles } from 'lucide-react';
import { Page } from '@renderer/components/Page';
import { Button } from '@renderer/components/ui/button';
import { Card, CardContent } from '@renderer/components/ui/card';
import { Badge } from '@renderer/components/ui/badge';
import { ProfileForm } from '@renderer/components/setup/ProfileForm';
import { StartSessionDialog } from '@renderer/components/setup/StartSessionDialog';
import { TestWithMeet } from '@renderer/components/setup/TestWithMeet';
import { useProfiles } from '@renderer/store/profiles';
import { useSession } from '@renderer/store/session';
import type { Profile } from '@shared/types/session';

const TYPE_LABEL: Record<Profile['type'], string> = {
  behavioral: 'Behavioral',
  technical: 'Technical',
  system_design: 'System design',
  sales: 'Sales',
  general: 'Meeting',
};

export default function Setup() {
  const profiles = useProfiles((s) => s.profiles);
  const loaded = useProfiles((s) => s.loaded);
  const load = useProfiles((s) => s.load);
  const activeProfile = useSession((s) => s.state.profile);
  const session = useSession((s) => s.state.session);
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState<Profile | null | 'new'>(params.get('new') ? 'new' : null);
  const [startFor, setStartFor] = useState<string | null | undefined>(undefined);
  const [testOpen, setTestOpen] = useState(params.get('test') ? true : false);

  useEffect(() => {
    void load();
  }, [load]);

  const closeEditor = () => {
    setEditing(null);
    if (params.get('new')) setParams({});
  };

  if (editing !== null) {
    return (
      <Page title={editing === 'new' ? 'New profile' : 'Edit profile'}>
        <ProfileForm
          key={editing === 'new' ? 'new' : editing.id}
          profile={editing === 'new' ? null : editing}
          onDone={closeEditor}
        />
      </Page>
    );
  }

  return (
    <Page
      title="Setup"
      subtitle="Profiles ground every answer in your résumé, the job and your stories."
      actions={
        <>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setTestOpen(true)}
            title="Check that the other party's audio is captured and transcribed"
          >
            <FlaskConical /> Test with Meet
          </Button>
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus /> New
          </Button>
        </>
      }
    >
      {loaded && profiles.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
            <Sparkles className="size-6 text-primary" />
            <p className="text-sm">Create your first session profile</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              Add the role, company, your résumé and the job description. Takes two minutes and
              makes every answer specific to you.
            </p>
            <Button size="sm" onClick={() => setEditing('new')}>
              <Plus /> New profile
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setStartFor(null)}>
              <Play /> Or start without a profile
            </Button>
          </CardContent>
        </Card>
      )}
      <div className="space-y-2">
        {profiles.map((p) => {
          const active = activeProfile?.id === p.id && !!session;
          return (
            <Card key={p.id} className={active ? 'border-primary/60' : undefined}>
              <CardContent className="flex items-start gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold">{p.name}</span>
                    <Badge variant="secondary">{TYPE_LABEL[p.type]}</Badge>
                    {active && <Badge variant="success">In session</Badge>}
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                    {(p.role || p.company) && (
                      <span className="flex items-center gap-1">
                        <Briefcase className="size-3" />{' '}
                        {[p.role, p.company].filter(Boolean).join(' @ ')}
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <FileText className="size-3" /> {p.resumeText ? 'résumé' : 'no résumé'} ·{' '}
                      {p.jdText ? 'JD' : 'no JD'} · {p.stories.length} stories
                      {p.knowledgeText ? ' · knowledge base' : ''}
                    </span>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col gap-1">
                  <Button size="xs" onClick={() => setStartFor(p.id)} disabled={!!session}>
                    <Play /> Start
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => setEditing(p)}>
                    Edit
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
      {startFor !== undefined && (
        <StartSessionDialog
          open
          onOpenChange={(o) => !o && setStartFor(undefined)}
          initialProfileId={startFor}
        />
      )}
      <TestWithMeet open={testOpen} onOpenChange={setTestOpen} />
    </Page>
  );
}
