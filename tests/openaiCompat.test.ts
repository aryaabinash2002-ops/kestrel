import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chatComplete, chatStream, toChatMessages } from '../src/main/llm/openaiCompat';
import { LLMService } from '../src/main/llm/LLMService';

let server: Server;
let baseUrl = '';
let lastBody: Record<string, unknown> = {};

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
