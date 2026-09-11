import { useState } from 'react';
import { SendHorizontal } from 'lucide-react';
import { invoke } from '@renderer/lib/ipc';
import { cn } from '@renderer/lib/utils';

const QUICK = [
  { label: 'Shorter', text: 'Give me a shorter version of the last answer — one sentence.' },
  {
    label: 'With numbers',
    text: 'Rework the last answer with a concrete, number-based example from my résumé.',
  },
  { label: 'Ask them back', text: 'What is a smart question I could ask them back right now?' },
  { label: 'Simplify', text: 'Explain the last answer in simpler, non-technical terms.' },
];

/** §2.1.6 follow-up box: quick requests answered with the whole session as context. */
export function ChatBox({ compact }: { compact?: boolean }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async (t: string) => {
    if (!t.trim()) return;
    setBusy(true);
    try {
      await invoke('answer:chat', t.trim());
      setText('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="shrink-0 border-t border-border/70 bg-card/60 px-2 pb-2 pt-1.5">
      {!compact && (
        <div className="mb-1 flex flex-wrap gap-1">
          {QUICK.map((q) => (
            <button
              key={q.label}
              className="no-drag rounded-full border border-border/70 px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={() => void send(q.text)}
              disabled={busy}
            >
              {q.label}
            </button>
          ))}
        </div>
      )}
      <form
        className="flex items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          void send(text);
        }}
      >
        <input
          className={cn(
            'no-drag selectable h-8 flex-1 rounded-md border border-input bg-background/60 px-2.5 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
          )}
          placeholder="Ask a follow-up: “shorter”, “give a number-based example”, “what should I ask them?”"
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={busy}
        />
        <button
          type="submit"
          className="no-drag flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground disabled:opacity-50"
          disabled={busy || !text.trim()}
          title="Send"
        >
          <SendHorizontal className="size-4" />
        </button>
      </form>
    </div>
  );
}
