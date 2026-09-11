import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import type { ParsedDocument } from '@shared/types/ipc';
import { logger } from '../logger';

const log = logger.scope('docs');

/** Collapse whitespace runs and drop obviously junk lines while keeping paragraph breaks. */
export function cleanExtractedText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/(\S)\n(?=[a-z])/g, '$1 ') // unwrap lines broken mid-sentence
    .trim();
}

async function parsePdf(data: Buffer): Promise<{ text: string; pages?: number }> {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(data) });
  try {
    const result = await parser.getText();
    return { text: result.text ?? '', pages: result.total ?? result.pages?.length };
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

async function parseDocx(data: Buffer): Promise<{ text: string }> {
  const mammoth = await import('mammoth');
  const result = await mammoth.extractRawText({ buffer: data });
  return { text: result.value };
}

const MAX_CHARS = 60_000;

/** Extract plain text from a PDF / DOCX / TXT / MD document (résumé or job description). */
export async function parseDocument(source: { path?: string; base64?: string; filename: string }): Promise<ParsedDocument> {
  const data = source.path ? readFileSync(source.path) : Buffer.from(source.base64 ?? '', 'base64');
  const ext = extname(source.filename).toLowerCase();
  let text: string;
  let pages: number | undefined;
  if (ext === '.pdf' || data.subarray(0, 4).toString() === '%PDF') {
    const r = await parsePdf(data);
    text = r.text;
    pages = r.pages;
  } else if (ext === '.docx') {
    text = (await parseDocx(data)).text;
  } else if (ext === '.doc') {
    throw new Error('Legacy .doc files are not supported — save as .docx or PDF.');
  } else {
    text = data.toString('utf8');
  }
  text = cleanExtractedText(text);
  if (!text) throw new Error('No text could be extracted (is it a scanned image? Try pasting the text instead).');
  if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS) + '\n…[truncated]';
  log.info(`parsed ${source.filename}: ${text.length} chars${pages ? `, ${pages} pages` : ''}`);
  return { text, filename: source.filename, pages, chars: text.length };
}
