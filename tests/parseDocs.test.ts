import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

const { parseDocument, cleanExtractedText } = await import('@main/docs/parseResume');
const fx = (f: string) => resolve(__dirname, 'fixtures', f);

describe('document parsing', () => {
  it('cleans extracted text (unwraps mid-sentence breaks, collapses whitespace)', () => {
    const out = cleanExtractedText('Led the   billing\nmigration to Stripe.\r\n\r\n\r\nNext   line');
    expect(out).toBe('Led the billing migration to Stripe.\n\nNext line');
  });

  it('parses plain text', async () => {
    const r = await parseDocument({ path: fx('resume.txt'), filename: 'resume.txt' });
    expect(r.text).toContain('Globex Corporation');
    expect(r.chars).toBeGreaterThan(100);
  });

  it('parses DOCX via mammoth', async () => {
    const r = await parseDocument({ path: fx('resume.docx'), filename: 'resume.docx' });
    expect(r.text).toContain('billing migration to Stripe');
    expect(r.text).toContain('Initech');
  });

  it.skipIf(!existsSync(fx('resume.pdf')))('parses PDF via pdf-parse', async () => {
    const r = await parseDocument({ path: fx('resume.pdf'), filename: 'resume.pdf' });
    expect(r.text).toContain('Globex');
    expect(r.pages).toBeGreaterThanOrEqual(1);
  });

  it('accepts base64 payloads from the renderer', async () => {
    const b64 = Buffer.from('Hello résumé world').toString('base64');
    const r = await parseDocument({ base64: b64, filename: 'notes.md' });
    expect(r.text).toBe('Hello résumé world');
  });

  it('fails clearly on empty documents', async () => {
    await expect(parseDocument({ base64: '', filename: 'empty.txt' })).rejects.toThrow(/No text/);
  });
});
