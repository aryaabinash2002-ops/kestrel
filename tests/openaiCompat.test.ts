import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chatComplete, chatStream, toChatMessages } from '../src/main/llm/openaiCompat';
import { LLMService } from '../src/main/llm/LLMService';

let server: Server;
let baseUrl = '';
let lastBody: Record<string, unknown> = {};
let stallFirst = 0; // number of upcoming stream requests that should hang until aborted
let rateLimitNext = 0; // number of upcoming requests answered with 429
let requests = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      if (req.url === '/v1/models') {
        res.writeHead(req.headers.authorization === 'Bearer good' ? 200 : 401, {
          'content-type': 'application/json',
        });
        res.end(JSON.stringify({ data: [] }));
        return;
      }
      lastBody = JSON.parse(raw);
      requests++;
      if (rateLimitNext > 0) {
        rateLimitNext--;
        res.writeHead(429, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'rate limited' } }));
        return;
      }
      if (stallFirst > 0) {
        stallFirst--;
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.flushHeaders();
        res.on('close', () => res.end()); // (req 'close' fires once the body is read — not what we want)
        return; // never writes a token until the client aborts
      }
      if (req.headers.authorization !== 'Bearer good') {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'bad key' } }));
        return;
      }
      if (lastBody['stream']) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const chunks = ['HEADLINE: I', ' can help.', '\nPOINTS:\n- one'];
        for (const c of chunks)
          res.write(
            `data: ${JSON.stringify({ choices: [{ delta: { content: c, reasoning_content: 'thinking…' }, finish_reason: null }] })}\n\n`,
          );
        res.write(
          `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 7 } })}\n\n`,
        );
        res.write('data: [DONE]\n\n');
        res.end();
      } else {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            choices: [{ message: { content: 'Sure: {"type":"behavioral","confidence":0.9}' } }],
          }),
        );
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}/v1`;
});
afterAll(() => server.close());

describe('openaiCompat', () => {
  it('converts Anthropic-shaped system + messages, including images', () => {
    const msgs = toChatMessages(
      [{ type: 'text', text: 'sys', cache_control: { type: 'ephemeral' } }],
      [
        { role: 'user', content: 'hi' },
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
            { type: 'text', text: 'solve' },
          ],
        },
      ],
    );
    expect(msgs[0]).toEqual({ role: 'system', content: 'sys' });
    expect(msgs[1]).toEqual({ role: 'user', content: 'hi' });
    expect(msgs[2]).toEqual({
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
        { type: 'text', text: 'solve' },
      ],
    });
  });

  it('streams content deltas (ignoring reasoning) and reads usage', async () => {
    const deltas: string[] = [];
    const r = await chatStream(
      { baseUrl, apiKey: 'good', model: 'm' },
      { messages: [{ role: 'user', content: 'q' }], maxTokens: 50, onDelta: (d) => deltas.push(d) },
    );
    expect(deltas).toEqual(['HEADLINE: I', ' can help.', '\nPOINTS:\n- one']);
    expect(r.text).toBe('HEADLINE: I can help.\nPOINTS:\n- one');
    expect(r.finishReason).toBe('stop');
    expect(r.usage).toEqual({ input: 12, output: 7 });
  });

  it('surfaces provider errors with status + message', async () => {
    await expect(
      chatComplete(
        { baseUrl, apiKey: 'bad', model: 'm' },
        { messages: [{ role: 'user', content: 'q' }], maxTokens: 5 },
      ),
    ).rejects.toThrow('401: bad key');
  });

  it('LLMService routes stream() and json() through the compat endpoint when selected', async () => {
    const llm = new LLMService({ get: async () => 'good' } as never, () => ({
      provider: 'openai_compatible',
      baseUrl,
      model: 'nvidia/test',
    }));
    expect(llm.usesCompat()).toBe(true);
    let first = 0;
    const res = await llm.stream({
      model: 'claude-haiku-ignored',
      system: 'sys',
      messages: [{ role: 'user', content: 'q' }],
      maxTokens: 50,
      fast: true,
      onText: () => undefined,
      onFirstToken: (ts) => (first = ts),
    });
    expect(res.model).toBe('nvidia/test');
    expect(lastBody['model']).toBe('nvidia/test');
    expect(first).toBeGreaterThan(0);
    expect(res.text.startsWith('HEADLINE:')).toBe(true);
    const j = await llm.json<{ type: string }>({
      model: 'x',
      system: 's',
      user: 'u',
      schema: { type: 'object' },
      schemaName: 'c',
    });
    expect(j.type).toBe('behavioral');
    expect(lastBody['stream']).toBe(false);
  });

  it('hedges a stalled stream and takes the second request', async () => {
    stallFirst = 1;
    requests = 0;
    const t0 = Date.now();
    const deltas: string[] = [];
    const r = await chatStream(
      { baseUrl, apiKey: 'good', model: 'm' },
      {
        messages: [{ role: 'user', content: 'q' }],
        maxTokens: 50,
        hedgeAfterMs: 150,
        onDelta: (d) => deltas.push(d),
      },
    );
    expect(r.text).toBe('HEADLINE: I can help.\nPOINTS:\n- one');
    expect(deltas.length).toBe(3);
    expect(requests).toBe(2);
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('retries a 429 before any token', async () => {
    rateLimitNext = 1;
    requests = 0;
    const r = await chatStream(
      { baseUrl, apiKey: 'good', model: 'm' },
      {
        messages: [{ role: 'user', content: 'q' }],
        maxTokens: 50,
        hedgeAfterMs: 0,
        onDelta: () => undefined,
      },
    );
    expect(r.text.startsWith('HEADLINE')).toBe(true);
    expect(requests).toBe(2);
    rateLimitNext = 1;
    const text = await chatComplete(
      { baseUrl, apiKey: 'good', model: 'm' },
      { messages: [{ role: 'user', content: 'q' }], maxTokens: 5 },
    );
    expect(text).toContain('behavioral');
  });

  it('aborting the caller signal rejects and stops deltas (hedge included)', async () => {
    stallFirst = 2; // both attempts hang → only the abort can end it
    const ac = new AbortController();
    const deltas: string[] = [];
    const p = chatStream(
      { baseUrl, apiKey: 'good', model: 'm' },
      {
        messages: [{ role: 'user', content: 'q' }],
        maxTokens: 50,
        hedgeAfterMs: 50,
        signal: ac.signal,
        onDelta: (d) => deltas.push(d),
      },
    );
    setTimeout(() => ac.abort(new Error('restart')), 200);
    await expect(p).rejects.toThrow('restart');
    expect(deltas).toEqual([]);
    stallFirst = 0;
  });

  it('fails clearly without a key', async () => {
    const llm = new LLMService({ get: async () => null } as never, () => ({
      provider: 'openai_compatible',
      baseUrl,
      model: 'm',
    }));
    await expect(
      llm.json({ model: 'x', system: 's', user: 'u', schema: {}, schemaName: 'c' }),
    ).rejects.toThrow('No provider API key');
  });
});
