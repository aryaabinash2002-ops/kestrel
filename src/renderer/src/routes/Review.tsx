import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Loader2, RefreshCw } from 'lucide-react';
import { Page } from '@renderer/components/Page';
import { Button } from '@renderer/components/ui/button';
import { SessionList } from '@renderer/components/review/SessionList';
import { SessionDetail } from '@renderer/components/review/SessionDetail';
import { useReview } from '@renderer/store/review';
import { useSession } from '@renderer/store/session';
import { toast } from '@renderer/store/toasts';

export default function Review() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const sessions = useReview((s) => s.sessions);
  const loaded = useReview((s) => s.loaded);
  const detail = useReview((s) => s.detail);
  const detailLoading = useReview((s) => s.detailLoading);
  const loadList = useReview((s) => s.loadList);
  const openSession = useReview((s) => s.openSession);
  const closeSession = useReview((s) => s.closeSession);
  const deleteSession = useReview((s) => s.deleteSession);
  const activeSession = useSession((s) => s.state.session);

  useEffect(() => {
    void loadList();
  }, [loadList, activeSession?.id, activeSession?.endedAt]);

  useEffect(() => {
    if (!sessionId) {
      closeSession();
      return;
    }
    void openSession(sessionId).then((d) => {
      if (!d) {
        toast({ kind: 'warning', title: 'Session not found' });
        navigate('/review', { replace: true });
      }
    });
  }, [sessionId, openSession, closeSession, navigate]);

  if (sessionId) {
    if (detail && detail.session.id === sessionId) {
      return <SessionDetail detail={detail} onBack={() => navigate('/review')} />;
    }
    return (
      <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />{' '}
        {detailLoading ? 'Loading session…' : 'Opening…'}
      </div>
    );
  }

  return (
    <Page
      title="Review"
      subtitle="Transcripts, suggested answers and AI feedback for every session."
      actions={
        <Button size="iconSm" variant="ghost" onClick={() => void loadList()} title="Refresh">
          <RefreshCw />
        </Button>
      }
    >
      {loaded ? (
        <SessionList
          sessions={sessions}
          activeId={activeSession?.id ?? null}
          onOpen={(id) => navigate(`/review/${id}`)}
          onDelete={async (id) => {
            await deleteSession(id);
            toast({ kind: 'success', title: 'Session deleted' });
          }}
        />
      ) : (
        <div className="py-8 text-center text-xs text-muted-foreground">Loading…</div>
      )}
    </Page>
  );
}
