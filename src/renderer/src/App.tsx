import { useEffect } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { TooltipProvider } from '@renderer/components/ui/tooltip';
import { Shell } from '@renderer/components/Shell';
import { Toaster } from '@renderer/components/Toaster';
import { useSettings } from '@renderer/store/settings';
import { useSession } from '@renderer/store/session';
import { useAudio } from '@renderer/store/audio';
import { on } from '@renderer/lib/ipc';
import Setup from '@renderer/routes/Setup';
import Live from '@renderer/routes/Live';
import Practice from '@renderer/routes/Practice';
import Review from '@renderer/routes/Review';
import Settings from '@renderer/routes/Settings';
import Onboarding from '@renderer/routes/Onboarding';

export default function App() {
  const loaded = useSettings((s) => s.loaded);
  const onboardingDone = useSettings((s) => s.settings.onboardingDone);
  const navigate = useNavigate();

  useEffect(() => {
    void useSettings.getState().load();
    void useSession.getState().refresh();
    void useAudio.getState().refresh();
    return on('navigate', ({ to }) => navigate(to));
  }, [navigate]);

  if (!loaded) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading Kestrel…
      </div>
    );
  }

  return (
    <TooltipProvider>
      <Routes>
        <Route path="/onboarding" element={<Onboarding />} />
        <Route element={<Shell />}>
          <Route path="/setup" element={<Setup />} />
          <Route path="/live" element={<Live />} />
          <Route path="/practice" element={<Practice />} />
          <Route path="/review" element={<Review />} />
          <Route path="/review/:sessionId" element={<Review />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/settings/:tab" element={<Settings />} />
        </Route>
        <Route
          path="*"
          element={<Navigate to={onboardingDone ? '/setup' : '/onboarding'} replace />}
        />
      </Routes>
      <Toaster />
    </TooltipProvider>
  );
}
