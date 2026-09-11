import { useState } from 'react';
import { ChevronDown, ChevronUp, Image as ImageIcon, X } from 'lucide-react';
import type { ScreenshotResult } from '@shared/types/session';
import { Markdown } from './Markdown';
import { cn } from '@renderer/lib/utils';

export function ScreenshotCard({ shot, onDismiss }: { shot: ScreenshotResult; onDismiss: (id: string) => void }) {
  const [collapsed, setCollapsed] = useState(false);
  const streaming = shot.status === 'streaming';
  return (
    <div className={cn('card-in rounded-lg border bg-card/80 shadow-sm', streaming ? 'border-primary/50' : 'border-border/70', shot.status === 'error' && 'border-destructive/50')}>
      <div className="flex items-center gap-1.5 px-3 pt-2">
        <ImageIcon className="size-3.5 text-primary" />
        <span className="text-[11px] text-muted-foreground">Screen solution{streaming ? ' — working…' : ''}</span>
        <span className="ml-auto flex items-center gap-1">
          <button className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground no-drag" onClick={() => setCollapsed((v) => !v)}>
            {collapsed ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}
          </button>
          <button className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground no-drag" onClick={() => onDismiss(shot.id)}>
            <X className="size-3.5" />
          </button>
        </span>
      </div>
      {!collapsed && (
        <div className="px-3 pb-3 pt-1 selectable">
          {shot.result ? <Markdown text={shot.result} streaming={streaming} /> : <p className="text-xs text-muted-foreground caret">Reading the screen…</p>}
        </div>
      )}
    </div>
  );
}
