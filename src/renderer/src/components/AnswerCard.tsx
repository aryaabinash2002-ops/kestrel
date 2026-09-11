import { useState } from 'react';
import { ChevronDown, ChevronUp, MessageSquareText, Sparkles, X, Zap } from 'lucide-react';
import type { AnswerCard as AnswerCardT } from '@shared/types/session';
import { cn } from '@renderer/lib/utils';

const TYPE_LABEL: Record<string, string> = {
  behavioral: 'Behavioral',
  technical: 'Technical',
  system_design: 'System design',
  coding: 'Coding',
  situational: 'Situational',
  smalltalk: 'Smalltalk',
  factual: 'Factual',
  sales: 'Sales',
  other: 'Question',
};

export function AnswerCard({
  card,
  showLatency,
  collapsedDefault,
  compact,
  onDismiss,
}: {
  card: AnswerCardT;
  showLatency: boolean;
  collapsedDefault: boolean;
  compact?: boolean;
  onDismiss: (id: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(collapsedDefault);
  const streaming = card.status === 'streaming';
  const ftl =
    card.latency.firstTokenTs && card.latency.questionEndTs
      ? card.latency.firstTokenTs - card.latency.questionEndTs
      : null;
  const hl =
    card.latency.headlineDoneTs && card.latency.questionEndTs
      ? card.latency.headlineDoneTs - card.latency.questionEndTs
      : null;
  const isChat = card.kind === 'chat';

  return (
    <div
      className={cn(
        'card-in rounded-lg border bg-card/80 shadow-sm transition-colors',
        streaming ? 'border-primary/50' : 'border-border/70',
        card.status === 'cancelled' && 'opacity-60',
        card.status === 'error' && 'border-destructive/50',
      )}
    >
      <div className="flex items-center gap-1.5 px-3 pt-2">
        {isChat ? (
          <MessageSquareText className="size-3.5 text-primary" />
        ) : card.kind === 'manual' ? (
          <Zap className="size-3.5 text-primary" />
        ) : (
          <Sparkles className="size-3.5 text-primary" />
        )}
        <span className="truncate text-[11px] text-muted-foreground" title={card.question}>
          {isChat ? 'You asked: ' : ''}
          {card.question}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {card.type && (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
              {TYPE_LABEL[card.type] ?? card.type}
            </span>
          )}
          {card.latency.speculative && (
            <span
              className="text-[9px] uppercase tracking-wide text-primary/80"
              title="Started before the question ended"
            >
              spec
            </span>
          )}
          {showLatency && ftl !== null && (
            <span
              className={cn(
                'font-mono text-[10px] tabular-nums',
                ftl <= 1000 ? 'text-success' : ftl <= 2000 ? 'text-warning' : 'text-destructive',
              )}
              title="ms from last word to first token / headline done"
            >
              {ftl}ms{hl !== null ? `·${hl}` : ''}
            </span>
          )}
          <button
            className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground no-drag"
            onClick={() => setCollapsed((v) => !v)}
            title={collapsed ? 'Expand' : 'Collapse'}
          >
            {collapsed ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}
          </button>
          <button
            className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground no-drag"
            onClick={() => onDismiss(card.id)}
            title="Dismiss"
          >
            <X className="size-3.5" />
          </button>
        </span>
      </div>
      <div className="px-3 pb-2.5 pt-1 selectable">
        <p
          className={cn(
            'font-semibold leading-snug',
            compact ? 'text-[13px]' : 'text-[15px]',
            streaming && !card.latency.headlineDoneTs && 'caret',
          )}
        >
          {card.headline ||
            (streaming ? (
              <span className="text-muted-foreground">Thinking…</span>
            ) : card.status === 'error' ? (
              <span className="text-destructive">{card.error ?? 'Failed'}</span>
            ) : (
              ''
            ))}
        </p>
        {!collapsed && isChat && card.content && (
          <p
            className={cn(
              'mt-1 whitespace-pre-wrap text-muted-foreground',
              compact ? 'text-xs' : 'text-[13px]',
              streaming && 'caret',
            )}
          >
            {card.content.split('\n').slice(1).join('\n').trim()}
          </p>
        )}
        {!collapsed && !isChat && card.points.length > 0 && (
          <ul
            className={cn(
              'mt-1.5 space-y-1 pl-4',
              compact ? 'text-xs' : 'text-[13px]',
              card.stale && 'opacity-60',
            )}
          >
            {card.points.map((p, i) => (
              <li
                key={i}
                className={cn(
                  'list-disc leading-snug marker:text-primary/70',
                  streaming && i === card.points.length - 1 && 'caret',
                )}
              >
                {p}
              </li>
            ))}
          </ul>
        )}
        {card.status === 'cancelled' && (
          <p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            cancelled
          </p>
        )}
      </div>
    </div>
  );
}
