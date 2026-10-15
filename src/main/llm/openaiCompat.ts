import type Anthropic from '@anthropic-ai/sdk';

/**
 * Minimal OpenAI-compatible chat client (NVIDIA NIM, Groq, OpenRouter, Ollama, vLLM, …).
 * Plain fetch + SSE parsing, no extra dependency. Anthropic-shaped system/messages are
 * converted so the rest of the app does not care which provider is active.
 */
export interface CompatConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export type ChatContent =
  | string
  | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: ChatContent;
}

export function systemText(system: Anthropic.TextBlockParam[] | string): string {
  return typeof system === 'string' ? system : system.map((b) => b.text).join('\n\n');
}

export function toChatMessages(
  system: Anthropic.TextBlockParam[] | string,
  messages: Anthropic.MessageParam[],
): ChatMessage[] {
  const out: ChatMessage[] = [];
  const sys = systemText(system);
  if (sys.trim()) out.push({ role: 'system', content: sys });
  for (const m of messages) {
    if (typeof m.content === 'string') {
      out.push({ role: m.role, content: m.content });
      continue;
    }
    const parts: Exclude<ChatContent, string> = [];
    for (const block of m.content) {
      if (block.type === 'text') parts.push({ type: 'text', text: block.text });
      else if (block.type === 'image' && block.source.type === 'base64')
        parts.push({
          type: 'image_url',
          image_url: { url: `data:${block.source.media_type};base64,${block.source.data}` },
        });
    }
    out.push({ role: m.role, content: parts });
  }
  return out;
}

function endpoint(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '') + '/chat/completions';
}

/** NVIDIA's Nemotron models accept a thinking toggle through chat_template_kwargs; others ignore it. */
function providerExtras(baseUrl: string, think: boolean): Record<string, unknown> {
  if (/nvidia\.com/i.test(baseUrl)) return { chat_template_kwargs: { enable_thinking: think } };
  return {};
}

async function errorMessage(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  try {
    const j = JSON.parse(text) as {
      error?: { message?: string } | string;
      detail?: string;
      message?: string;
    };
    const e = j.error;
    const msg = (typeof e === 'string' ? e : e?.message) ?? j.detail ?? j.message;
    if (msg) return `${res.status}: ${msg}`;
  } catch {
    /* not JSON */
  }
  return `${res.status}: ${text.slice(0, 300) || res.statusText}`;
}

function combinedSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const t = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, t]) : t;
}

export interface CompatStreamArgs {
  messages: ChatMessage[];
  maxTokens: number;
  temperature?: number;
  think?: boolean;
  signal?: AbortSignal;
  onDelta: (delta: string) => void;
  /** Fire a second identical request if no token arrived after this long (tail-latency hedge). */
  hedgeAfterMs?: number;
}

const RETRYABLE = /^(429|5\d\d):/;

export interface CompatResult {
  text: string;
  finishReason: string | null;
  usage: { input: number; output: number };
}

async function chatStreamOnce(cfg: CompatConfig, a: CompatStreamArgs): Promise<CompatResult> {
  const res = await fetch(endpoint(cfg.baseUrl), {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: cfg.model,
      messages: a.messages,
      max_tokens: a.maxTokens,
      ...(a.temperature !== undefined ? { temperature: a.temperature } : {}),
      stream: true,
      ...providerExtras(cfg.baseUrl, !!a.think),
    }),
    signal: combinedSignal(a.signal, 90_000),
  });
  if (!res.ok || !res.body) throw new Error(await errorMessage(res));
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let text = '';
  let finish: string | null = null;
  const usage = { input: 0, output: 0 };
  const handleLine = (line: string) => {
    if (!line.startsWith('data:')) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    let j: {
      choices?: Array<{ delta?: { content?: string | null }; finish_reason?: string | null }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
    };
    try {
      j = JSON.parse(payload);
    } catch {
      return;
    }
    if (j.usage) {
      usage.input = j.usage.prompt_tokens ?? usage.input;
      usage.output = j.usage.completion_tokens ?? usage.output;
    }
    const c = j.choices?.[0];
    if (!c) return;
    if (c.finish_reason) finish = c.finish_reason;
    const delta = c.delta?.content;
    if (delta) {
      text += delta;
      a.onDelta(delta);
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      handleLine(buf.slice(0, nl).trimEnd());
      buf = buf.slice(nl + 1);
    }
  }
  if (buf.trim()) handleLine(buf.trim());
  return { text, finishReason: finish, usage };
}

/**
 * Hedged stream: free/shared endpoints occasionally stall for many seconds before the first
 * byte. After `hedgeAfterMs` without a token a second identical request starts; the first one
 * to produce a token wins and the other is aborted. Failures before any token are retried
 * (up to 3 attempts in total, short pause on 429/5xx).
 */
export function chatStream(cfg: CompatConfig, a: CompatStreamArgs): Promise<CompatResult> {
  const hedgeAfter = a.hedgeAfterMs ?? 1800;
  const MAX_ATTEMPTS = 3;
  return new Promise<CompatResult>((resolve, reject) => {
    let winner = -1;
    let attempts = 0;
    let running = 0;
    let lastErr: unknown = null;
    let settled = false;
    const controllers: AbortController[] = [];
    let hedgeTimer: ReturnType<typeof setTimeout> | null = null;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (hedgeTimer) clearTimeout(hedgeTimer);
      for (const c of controllers) c.abort();
      fn();
    };
    a.signal?.addEventListener('abort', () =>
      finish(() => reject(a.signal?.reason ?? new Error('aborted'))),
    );

    const launch = () => {
      if (settled || attempts >= MAX_ATTEMPTS) return;
      const idx = attempts++;
      running++;
      const ac = new AbortController();
      controllers.push(ac);
      chatStreamOnce(cfg, {
        ...a,
        signal: ac.signal,
        onDelta: (d) => {
          if (settled) return;
          if (winner === -1) {
            winner = idx;
            if (hedgeTimer) clearTimeout(hedgeTimer);
            controllers.forEach((c, i) => i !== idx && c.abort());
          }
          if (winner === idx) a.onDelta(d);
        },
      }).then(
        (res) => {
          if (winner === idx || (winner === -1 && res.text)) finish(() => resolve(res));
          else if (winner === -1) {
            // Empty stream without a token: treat as a failure of this attempt.
            running--;
            lastErr = new Error('empty response');
            if (running === 0) scheduleRetry(0);
          }
        },
        (err) => {
          if (settled || winner === idx) return;
          running--;
          if (winner !== -1) return; // a loser being aborted
          lastErr = err;
          if (attempts >= MAX_ATTEMPTS && running === 0) finish(() => reject(err));
          else if (running === 0)
            scheduleRetry(RETRYABLE.test(String((err as Error).message)) ? 400 : 0);
        },
      );
      if (idx === 0 && hedgeAfter > 0)
        hedgeTimer = setTimeout(() => winner === -1 && launch(), hedgeAfter);
    };
    const scheduleRetry = (delay: number) => {
      if (settled) return;
      if (attempts >= MAX_ATTEMPTS) {
        finish(() => reject(lastErr instanceof Error ? lastErr : new Error(String(lastErr))));
        return;
      }
      setTimeout(launch, delay);
    };
    launch();
  });
}

export async function chatComplete(
  cfg: CompatConfig,
  a: { messages: ChatMessage[]; maxTokens: number; temperature?: number; signal?: AbortSignal },
  retried = false,
): Promise<string> {
  const res = await fetch(endpoint(cfg.baseUrl), {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: cfg.model,
      messages: a.messages,
      max_tokens: a.maxTokens,
      ...(a.temperature !== undefined ? { temperature: a.temperature } : {}),
      stream: false,
      ...providerExtras(cfg.baseUrl, false),
    }),
    signal: combinedSignal(a.signal, 90_000),
  });
  if (!res.ok) {
    const msg = await errorMessage(res);
    if (RETRYABLE.test(msg) && !a.signal?.aborted && !retried) {
      await new Promise((r) => setTimeout(r, 400));
      return chatComplete(cfg, a, true);
    }
    throw new Error(msg);
  }
  const j = (await res.json()) as { choices?: Array<{ message?: { content?: string | null } }> };
  return j.choices?.[0]?.message?.content ?? '';
}

/** Cheap reachability + key check: GET /models. */
export async function testCompat(
  baseUrl: string,
  apiKey: string,
): Promise<{ ok: boolean; message: string }> {
  const res = await fetch(baseUrl.replace(/\/+$/, '') + '/models', {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15_000),
  });
  return res.ok
    ? { ok: true, message: 'Provider accepted the key' }
    : { ok: false, message: await errorMessage(res) };
}
