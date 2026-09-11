import type { ParsedDocument } from '@shared/types/ipc';
import { cleanExtractedText } from './parseResume';
import { logger } from '../logger';

const log = logger.scope('import');
const MAX_ARTICLES = 40;
const MAX_TOTAL = 90_000;

/** Very small HTML → text: drops scripts/styles, keeps headings/lists/paragraph breaks. */
export function htmlToText(html: string): string {
  let body = html;
  const article =
    /<article[^>]*>([\s\S]*?)<\/article>/i.exec(body) ??
    /<main[^>]*>([\s\S]*?)<\/main>/i.exec(body);
  if (article?.[1]) body = article[1];
  body = body.replace(/<(script|style|noscript|svg|nav|header|footer)[^>]*>[\s\S]*?<\/\1>/gi, '');
  body = body.replace(/<(h[1-6])[^>]*>/gi, '\n\n## ').replace(/<\/h[1-6]>/gi, '\n');
  body = body.replace(/<li[^>]*>/gi, '\n- ');
  body = body.replace(/<(p|div|br|tr|section)[^>]*>/gi, '\n');
  body = body.replace(/<[^>]+>/g, '');
  body = body
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)));
  return cleanExtractedText(body);
}

function pageTitle(html: string, url: string): string {
  const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim();
  if (t) return t.replace(/\s*[|–-]\s*[^|–-]*$/, '').trim() || t;
  const slug = url.split('/').filter(Boolean).pop() ?? url;
  const words = slug.replace(/^\d+-/, '').replace(/[-_]+/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'user-agent': 'Kestrel/0.1 (+knowledge import)' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

/**
 * Import a page as knowledge. If the page is a help-centre collection (Intercom, Zendesk,
 * GitBook-style: many links to article pages on the same host), every article is fetched too.
 */
export async function importUrl(url: string): Promise<ParsedDocument> {
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol)) throw new Error('Only http(s) URLs are supported');
  const html = await fetchText(url);
  const host = u.host;
  const linkRe = /href="(https?:\/\/[^"]+|\/[^"]+)"/g;
  const articles = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html))) {
    let href = m[1] ?? '';
    if (href.startsWith('/')) href = `${u.protocol}//${host}${href}`;
    try {
      const a = new URL(href);
      if (a.host !== host) continue;
      if (
        /\/(articles?|hc\/[a-z-]+\/articles|docs|guide|guides|kb|knowledge)\//i.test(a.pathname) &&
        a.pathname !== u.pathname
      ) {
        a.hash = '';
        a.search = '';
        articles.add(a.toString());
      }
    } catch {
      /* skip */
    }
  }
  const parts: string[] = [];
  const title = pageTitle(html, url);
  if (articles.size === 0) {
    parts.push(`# ${title}\nSource: ${url}\n\n${htmlToText(html)}`);
  } else {
    log.info(`collection ${url}: ${articles.size} articles`);
    const list = [...articles].slice(0, MAX_ARTICLES);
    const results = await Promise.all(
      list.map(async (a) => {
        try {
          const h = await fetchText(a);
          return `# ${pageTitle(h, a)}\nSource: ${a}\n\n${htmlToText(h)}`;
        } catch (err) {
          log.warn('article failed', a, err);
          return '';
        }
      }),
    );
    parts.push(`# ${title}\nSource: ${url}`, ...results.filter(Boolean));
  }
  let text = parts.join('\n\n---\n\n').trim();
  if (text.length > MAX_TOTAL) text = text.slice(0, MAX_TOTAL) + '\n…[truncated]';
  if (text.length < 200)
    throw new Error(
      'The page had almost no readable text (is it behind a login or rendered only by JavaScript?)',
    );
  return {
    text,
    filename: `${title} (${articles.size || 1} page${articles.size > 1 ? 's' : ''})`,
    chars: text.length,
  };
}
