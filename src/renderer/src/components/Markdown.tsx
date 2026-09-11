import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@renderer/lib/utils';

/**
 * Tiny dependency-free markdown renderer for model output: headings, bullet lists,
 * numbered lists, paragraphs, inline code and fenced code blocks (with a copy button).
 */
export function Markdown({
  text,
  className,
  streaming,
}: {
  text: string;
  className?: string;
  streaming?: boolean;
}) {
  const blocks = parseBlocks(text);
  return (
    <div className={cn('prose-tight text-[13px] leading-snug', className)}>
      {blocks.map((b, i) => {
        const last = i === blocks.length - 1;
        switch (b.type) {
          case 'code':
            return <CodeBlock key={i} code={b.text} lang={b.lang} streaming={streaming && last} />;
          case 'heading':
            return b.level <= 2 ? (
              <h2 key={i} className="text-sm">
                {inline(b.text)}
              </h2>
            ) : (
              <h3 key={i} className="text-[13px]">
                {inline(b.text)}
              </h3>
            );
          case 'ul':
            return (
              <ul key={i}>
                {b.items.map((it, j) => (
                  <li key={j}>{inline(it)}</li>
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol key={i} className="ml-4 list-decimal">
                {b.items.map((it, j) => (
                  <li key={j}>{inline(it)}</li>
                ))}
              </ol>
            );
          default:
            return (
              <p key={i} className={cn(streaming && last && 'caret')}>
                {inline(b.text)}
              </p>
            );
        }
      })}
    </div>
  );
}

type Block =
  | { type: 'p'; text: string }
  | { type: 'heading'; level: number; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] }
  | { type: 'code'; lang: string; text: string };

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r/g, '').split('\n');
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (/^```/.test(line)) {
      const lang = line.replace(/^```/, '').trim();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i] ?? '')) {
        buf.push(lines[i] ?? '');
        i++;
      }
      i++;
      out.push({ type: 'code', lang, text: buf.join('\n') });
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      out.push({ type: 'heading', level: h[1]!.length, text: h[2] ?? '' });
      i++;
      continue;
    }
    if (/^\s*[-*•]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i] ?? '')) {
        items.push((lines[i] ?? '').replace(/^\s*[-*•]\s+/, ''));
        i++;
      }
      out.push({ type: 'ul', items });
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i] ?? '')) {
        items.push((lines[i] ?? '').replace(/^\s*\d+[.)]\s+/, ''));
        i++;
      }
      out.push({ type: 'ol', items });
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const buf: string[] = [];
    while (
      i < lines.length &&
      (lines[i] ?? '').trim() &&
      !/^(```|#{1,6}\s|\s*[-*•]\s|\s*\d+[.)]\s)/.test(lines[i] ?? '')
    ) {
      buf.push(lines[i] ?? '');
      i++;
    }
    out.push({ type: 'p', text: buf.join(' ') });
  }
  return out;
}

function inline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('`')) parts.push(<code key={k++}>{tok.slice(1, -1)}</code>);
    else parts.push(<b key={k++}>{tok.slice(2, -2)}</b>);
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function CodeBlock({ code, lang, streaming }: { code: string; lang: string; streaming?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      <pre className={cn(streaming && 'caret')}>
        <code>{code}</code>
      </pre>
      <button
        className="no-drag absolute right-1.5 top-1.5 flex items-center gap-1 rounded border border-border bg-popover/90 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
        onClick={() => {
          void navigator.clipboard.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
        title="Copy code"
      >
        {copied ? <Check className="size-3" /> : <Copy className="size-3" />} {lang || 'copy'}
      </button>
    </div>
  );
}
