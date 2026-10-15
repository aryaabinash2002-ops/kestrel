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
}

export interface CompatResult {
  text: string;
  finishReason: string | null;
  usage: { input: number; output: number };
}

export async function chatStream(cfg: CompatConfig, a: CompatStreamArgs): Promise<CompatResult> {
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

export async function chatComplete(
  cfg: CompatConfig,
  a: { messages: ChatMessage[]; maxTokens: number; temperature?: number; signal?: AbortSignal },
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
  if (!res.ok) throw new Error(await errorMessage(res));
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
