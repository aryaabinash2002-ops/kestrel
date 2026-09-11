import Anthropic from '@anthropic-ai/sdk';
import { startFakeAnthropic } from './fake-anthropic.mjs';
const fake = await startFakeAnthropic({ tokenDelayMs: 2, firstTokenDelayMs: 20 });
console.log('fake at', fake.url);
const client = new Anthropic({
  apiKey: 'k',
  baseURL: fake.url,
  maxRetries: 0,
  logLevel: 'debug',
  timeout: 8000,
});
const t = setInterval(() => console.log('requests seen', fake.requests.length), 2000);
try {
  const stream = client.messages.stream({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 350,
    system: [{ type: 'text', text: 'sys' }],
    messages: [{ role: 'user', content: 'Question: hi?' }],
  });
  let n = 0;
  stream.on('text', () => n++);
  stream.on('error', (e) => console.log('stream error event', e?.message));
  const final = await stream.finalMessage();
  console.log(
    'OK deltas',
    n,
    'stop',
    final.stop_reason,
    'text',
    final.content[0]?.text?.slice(0, 40),
  );
} catch (e) {
  console.log('ERR', e?.constructor?.name, e?.message, e?.status, JSON.stringify(e?.error));
}
clearInterval(t);
await fake.close();
