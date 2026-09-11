import { NavLink, Outlet } from 'react-router-dom';
import { Bird, FileText, GraduationCap, Radio, Settings2, Sparkles } from 'lucide-react';
import { cn } from '@renderer/lib/utils';
import { isMac } from '@renderer/lib/ipc';
import { useSession } from '@renderer/store/session';
import { useAudio } from '@renderer/store/audio';
import { ListeningIndicator } from './ListeningIndicator';

const nav = [
  { to: '/setup', label: 'Setup', icon: Sparkles },
  { to: '/live', label: 'Live', icon: Radio },
  { to: '/practice', label: 'Practice', icon: GraduationCap },
  { to: '/review', label: 'Review', icon: FileText },
  { to: '/settings', label: 'Settings', icon: Settings2 },
];

export function Shell() {
  const listening = useAudio((s) => s.state?.listening ?? false);
  const session = useSession((s) => s.state.session);
  return (
    <div className="flex h-full flex-col bg-background">
      <header className={cn('drag flex h-10 shrink-0 items-center gap-2 border-b border-border/70 px-3', isMac && 'pl-[84px]')}>
        <Bird className="size-4 text-primary" />
        <span className="text-xs font-semibold tracking-wide">Kestrel</span>
        <div className="ml-auto flex items-center gap-2">
          <ListeningIndicator listening={listening} active={!!session} />
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-hidden">
        <Outlet />
      </main>
      <nav className="flex h-11 shrink-0 items-stretch border-t border-border/70 bg-card/60">
        {nav.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'no-drag flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:text-foreground',
                isActive && 'text-primary',
              )
            }
          >
            <Icon className="size-4" />
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
