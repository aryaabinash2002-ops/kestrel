import { useRef, useState } from 'react';
import { FileUp, Loader2 } from 'lucide-react';
import { Button } from '@renderer/components/ui/button';
import { Textarea } from '@renderer/components/ui/textarea';
import { Label } from '@renderer/components/ui/label';
import { invoke } from '@renderer/lib/ipc';
import { toast } from '@renderer/store/toasts';

/** Paste-or-upload text field for résumé / job description. */
export function DocumentField({
  label,
  hint,
  value,
  onChange,
  rows = 6,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
}) {
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const pick = async () => {
    setBusy(true);
    try {
      const doc = await invoke('profiles:pickDocument');
      if (doc) {
        onChange(doc.text);
        toast({
          kind: 'success',
          title: `Imported ${doc.filename}`,
          message: `${doc.chars.toLocaleString()} characters${doc.pages ? `, ${doc.pages} pages` : ''}`,
        });
      }
    } catch (err) {
      toast({ kind: 'error', title: 'Could not read the document', message: String(err) });
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (file: File) => {
    setBusy(true);
    try {
      const buf = await file.arrayBuffer();
      let bin = '';
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i += 0x8000)
        bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      const doc = await invoke('profiles:parseDocument', {
        base64: btoa(bin),
        filename: file.name,
      });
      onChange(doc.text);
      toast({
        kind: 'success',
        title: `Imported ${doc.filename}`,
        message: `${doc.chars.toLocaleString()} characters`,
      });
    } catch (err) {
      toast({ kind: 'error', title: 'Could not read the document', message: String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="space-y-1.5"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer.files[0];
        if (f) void onFile(f);
      }}
    >
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground">
            {value.length.toLocaleString()} chars
          </span>
          <Button size="xs" variant="outline" onClick={() => void pick()} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <FileUp />} PDF / DOCX
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.docx,.txt,.md"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
              e.target.value = '';
            }}
          />
        </div>
      </div>
      <Textarea
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={hint ?? 'Paste text or drop a PDF/DOCX here'}
        className="font-mono text-xs leading-relaxed"
      />
    </div>
  );
}
