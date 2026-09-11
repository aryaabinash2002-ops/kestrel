// Minimal stand-in for the Anthropic Messages API (streaming + non-streaming) for tests
// and offline demos. Answers are scripted per request via `responder(body) → string`.
// Standalone: node scripts/dev/fake-anthropic.mjs [port]  → then KESTREL_ANTHROPIC_BASE_URL=http://127.0.0.1:<port>
import { createServer } from 'node:http';

export function defaultResponder(body) {
  const user = Array.isArray(body.messages) ? body.messages[body.messages.length - 1] : null;
  const content =
    typeof user?.content === 'string'
      ? user.content
      : (user?.content ?? []).map((b) => b.text ?? '').join('\n');
  const q = (content.match(/Question:\s*([\s\S]*)$/) ?? [])[1]?.trim() ?? content.slice(0, 80);
  const fmt = body.output_config?.format;
  if (fmt && fmt.type === 'json_schema') {
    const props = fmt.schema?.properties ?? {};
    if ('is_question' in props) {
      const isQ = /\?|tell me|walk me|describe|explain|what|why|how|can you|could you/i.test(q);
      const type = /time you|conflict|challenge|strength|weakness|tell me about/i.test(q)
        ? 'behavioral'
        : /how are you|good morning|hear me/i.test(q)
          ? 'smalltalk'
          : 'technical';
      return JSON.stringify({ is_question: isQ, question: q.replace(/\s+/g, ' '), type });
    }
    if ('score' in props) {
      return JSON.stringify({
        score: 7,
        relevance: 8,
        structure: 6,
        specificity: 7,
        conciseness: 7,
        strengths: ['Clear outcome'],
        improve_one_thing: 'Quantify the result.',
        model_answer: 'At Globex I led the billing migration, cutting invoice errors by 40%.',
      });
    }
    if ('summary' in props) {
      return JSON.stringify({
        summary: 'A solid conversation.',
        questions: [q],
        weakSpots: ['Answer was vague on metrics — add numbers next time.'],
        followUpEmail: 'Hi [Name],\n\nThank you for the conversation today.',
        actionItems: ['Send follow-up email'],
      });
    }
    return JSON.stringify({});
  }
  if (/Follow-up request from the user/.test(content))
    return `Here is a shorter version.\nKeep it to one example and one number.`;
  if (/screenshot|## Problem/i.test(body.system?.[0]?.text ?? body.system ?? ''))
    return '## Problem\nTwo-sum.\n\n## Approach\n- Hash map.\n\n## Pseudocode\nloop\n\n## Complexity\nO(n) time, O(n) space\n\n## Edge cases\n- empty\n\n## Code\n```python\ndef two_sum(a, t):\n    seen = {}\n```';
  return `HEADLINE: Absolutely — at Globex I led the billing migration to Stripe with zero downtime.\nPOINTS:\n- Situation: legacy invoicing caused 12% payment failures.\n- Task: replace it in one quarter without disrupting customers.\n- Action: phased rollout, dual-write period, nightly reconciliation.\n- Result: failures down to 1%, $1.2M recovered annually.\n`;
}

/**
 * @param {object} opts
 * @param {(body:any)=>string} [opts.responder]
 * @param {number} [opts.tokenDelayMs]  delay between streamed chunks
 * @param {number} [opts.firstTokenDelayMs] delay before the first chunk
 */
export function startFakeAnthropic(opts = {}) {
  const responder = opts.responder ?? defaultResponder;
  const tokenDelayMs = opts.tokenDelayMs ?? 8;
  const firstTokenDelayMs = opts.firstTokenDelayMs ?? 120;
  const requests = [];
  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url?.startsWith('/v1/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'claude-haiku-4-5-20251001', type: 'model' }] }));
      return;
    }
    if (req.method !== 'POST' || !req.url?.startsWith('/v1/messages')) {
      res.writeHead(404);
      res.end();
      return;
    }
    if (req.headers['x-api-key'] === 'bad-key') {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          type: 'error',
          error: { type: 'authentication_error', message: 'invalid x-api-key' },
        }),
      );
      return;
    }
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      const body = JSON.parse(raw);
      const rec = { body, at: Date.now(), aborted: false };
      requests.push(rec);
      const text = responder(body);
      const usage = {
        input_tokens: 900,
        output_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      };
      const sysBlocks = Array.isArray(body.system) ? body.system : [];
      if (sysBlocks.some((b) => b.cache_control)) {
        const seen = requests.filter(
          (r) => r !== rec && JSON.stringify(r.body.system) === JSON.stringify(body.system),
        ).length;
        if (seen) usage.cache_read_input_tokens = 800;
        else usage.cache_creation_input_tokens = 800;
      }
      if (body.max_tokens === 1) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            id: 'msg_warm',
            type: 'message',
            role: 'assistant',
            model: body.model,
            content: [{ type: 'text', text: 'ok' }],
            stop_reason: 'max_tokens',
            stop_sequence: null,
            usage: { ...usage, output_tokens: 1 },
          }),
        );
        return;
      }
      if (!body.stream) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            id: 'msg_1',
            type: 'message',
            role: 'assistant',
            model: body.model,
            content: [{ type: 'text', text }],
            stop_reason: 'end_turn',
            stop_sequence: null,
            usage: { ...usage, output_tokens: 50 },
          }),
        );
        return;
      }
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      send('message_start', {
        type: 'message_start',
        message: {
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model: body.model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage,
        },
      });
      send('content_block_start', {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      });
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      // Note: IncomingMessage 'close' fires once the body is consumed; client aborts show up
      // as the *response* closing before it finished.
      res.on('close', () => {
        if (!res.writableFinished) rec.aborted = true;
      });
      await sleep(firstTokenDelayMs);
      // Stream word by word to mimic tokens.
      const parts = text.match(/\S+\s*|\s+/g) ?? [text];
      let out = 0;
      for (const p of parts) {
        if (rec.aborted || res.destroyed) return;
        send('content_block_delta', {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: p },
        });
        out++;
        await sleep(tokenDelayMs);
      }
      send('content_block_stop', { type: 'content_block_stop', index: 0 });
      send('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: out },
      });
      send('message_stop', { type: 'message_stop' });
      res.end();
    });
  });
  return new Promise((resolve) => {
    server.listen(opts.port ?? 0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        requests,
        close: () =>
          new Promise((r) => {
            server.close(() => r());
            server.closeAllConnections();
          }),
      });
    });
  });
}

if (process.argv[1] && process.argv[1].endsWith('fake-anthropic.mjs')) {
  const port = Number(process.argv[2] ?? 47800);
  const s = await startFakeAnthropic({ port });
  console.log('fake anthropic listening at', s.url);
}
