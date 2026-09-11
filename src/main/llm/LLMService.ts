import Anthropic from '@anthropic-ai/sdk';
import type { SecretStore } from '../secrets';
import { logger } from '../logger';

const log = logger.scope('llm');

export interface StreamRequest {
  model: string;
  system: Anthropic.TextBlockParam[] | string;
  messages: Anthropic.MessageParam[];
  maxTokens: number;
  temperature?: number;
  signal?: AbortSignal;
  /** Disable thinking + low effort on models that support it (live path). */
  fast?: boolean;
  /** Adaptive thinking with summarized display (heavy path). */
  think?: boolean;
  onText: (delta: string, full: string) => void;
  onFirstToken?: (ts: number) => void;
}

export interface StreamResult {
  text: string;
  stopReason: string | null;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
  model: string;
}

export interface JsonRequest {
  model: string;
  system: string;
  user: string;
  schema: Record<string, unknown>;
  schemaName: string;
  maxTokens?: number;
  signal?: AbortSignal;
}

function modelSupportsEffort(model: string): boolean {
  return !/haiku/.test(model);
}

/**
 * One Anthropic client for the whole app, created once. The SDK's fetch transport keeps
 * connections alive, and `warm()` opens one at session start. All calls stream;
 * cancellation is via AbortSignal. Keys come from the secret store only.
 */
export class LLMService {
  private client: Anthropic | null = null;
  private keyUsed: string | null = null;

  constructor(private secrets: SecretStore) {}

  async getClient(): Promise<Anthropic> {
    let key = await this.secrets.get('anthropic');
    // Developer escape hatch: use the SDK's own credential resolution (ANTHROPIC_API_KEY /
    // `ant auth login` profile) when no key is stored. Never used in packaged builds.
    const devProfile = !key && process.env['KESTREL_DEV_ANTHROPIC_ENV'] === '1';
    if (!key && !devProfile) throw new Error('No Anthropic API key. Add it in Settings → Keys.');
    if (devProfile) key = '__env__';
    if (this.client && this.keyUsed === key) return this.client;
    this.client = new Anthropic({
      ...(devProfile ? {} : { apiKey: key ?? undefined }),
      maxRetries: 1,
      timeout: 60_000,
      baseURL: process.env['KESTREL_ANTHROPIC_BASE_URL'] || undefined,
    });
    this.keyUsed = key;
    return this.client;
  }

  invalidate(): void {
    this.client = null;
    this.keyUsed = null;
  }

  /** Tiny request that opens the TLS connection and (if the prefix is cacheable) writes the cache. */
  async warm(model: string, system: Anthropic.TextBlockParam[]): Promise<{ cacheWrite: number; cacheRead: number } | null> {
    try {
      const client = await this.getClient();
      const t0 = Date.now();
      const res = await client.messages.create({
        model,
        max_tokens: 1,
        system,
        messages: [{ role: 'user', content: 'ok' }],
        ...(modelSupportsEffort(model) ? { thinking: { type: 'disabled' as const } } : {}),
      });
      const cacheWrite = res.usage.cache_creation_input_tokens ?? 0;
      const cacheRead = res.usage.cache_read_input_tokens ?? 0;
      log.info(`warm-up ${model} in ${Date.now() - t0} ms (cache write ${cacheWrite}, read ${cacheRead})`);
      return { cacheWrite, cacheRead };
    } catch (err) {
      log.warn('warm-up failed', err);
      return null;
    }
  }

  async stream(req: StreamRequest): Promise<StreamResult> {
    const client = await this.getClient();
    const params: Anthropic.MessageCreateParamsStreaming = {
      model: req.model,
      max_tokens: req.maxTokens,
      system: req.system,
      messages: req.messages,
      stream: true,
    };
    if (req.temperature !== undefined && /haiku/.test(req.model)) params.temperature = req.temperature;
    if (req.fast && modelSupportsEffort(req.model)) {
      params.thinking = { type: 'disabled' };
      params.output_config = { effort: 'low' };
    } else if (req.think && modelSupportsEffort(req.model)) {
      params.thinking = { type: 'adaptive', display: 'summarized' };
      params.output_config = { effort: 'medium' };
    }
    const stream = client.messages.stream(params, { signal: req.signal });
    let full = '';
    let first = true;
    stream.on('text', (delta) => {
      if (first) {
        first = false;
        req.onFirstToken?.(Date.now());
      }
      full += delta;
      req.onText(delta, full);
    });
    const final = await stream.finalMessage();
    if (final.stop_reason === 'refusal') {
      throw new Error('The model declined to answer this request.');
    }
    return {
      text: full,
      stopReason: final.stop_reason,
      usage: {
        input: final.usage.input_tokens,
        output: final.usage.output_tokens,
        cacheRead: final.usage.cache_read_input_tokens ?? 0,
        cacheWrite: final.usage.cache_creation_input_tokens ?? 0,
      },
      model: final.model,
    };
  }

  /**
   * Structured JSON completion (classifier, scorer, review). Uses structured outputs
   * when the model accepts them, falling back to parsing the first JSON object in text.
   */
  async json<T>(req: JsonRequest): Promise<T> {
    const client = await this.getClient();
    const base = {
      model: req.model,
      max_tokens: req.maxTokens ?? 1024,
      system: req.system,
      messages: [{ role: 'user' as const, content: req.user }],
      ...(modelSupportsEffort(req.model) ? { thinking: { type: 'disabled' as const }, output_config: { effort: 'low' as const } } : {}),
    };
    try {
      const res = await client.messages.create(
        {
          ...base,
          output_config: {
            ...(base.output_config ?? {}),
            format: { type: 'json_schema', schema: req.schema },
          },
        } as Anthropic.MessageCreateParamsNonStreaming,
        { signal: req.signal },
      );
      const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
      return JSON.parse(text) as T;
    } catch (err) {
      if (req.signal?.aborted) throw err;
      if (err instanceof Anthropic.BadRequestError) {
        log.debug('structured output rejected, falling back to free-form JSON', err.message);
        const res = await client.messages.create(
          { ...base, system: `${req.system}\n\nRespond with a single JSON object only, matching this JSON schema: ${JSON.stringify(req.schema)}` },
          { signal: req.signal },
        );
        const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
        const m = text.match(/\{[\s\S]*\}/);
        if (!m) throw new Error('No JSON in model response');
        return JSON.parse(m[0]) as T;
      }
      throw err;
    }
  }
}
