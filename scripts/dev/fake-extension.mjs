// Simulates the Chrome extension against a running Kestrel app (dev tool + smoke check).
// Usage: node scripts/dev/fake-extension.mjs [--leave-after ms] [--audio-file pcm16-16k.raw] [--db path/to/kestrel.db] [--port 47600]
import WebSocket from 'ws';
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const leaveAfter = Number(opt('--leave-after', '0'));
const audioFile = opt('--audio-file', '');
const port = Number(opt('--port', process.env.KESTREL_EXT_PORT ?? '47600'));
const db = opt('--db', join(homedir(), 'Library/Application Support/kestrel/data/kestrel.db'));

function readToken() {
  try {
    return execSync(`sqlite3 "${db}" "select value from meta where key='extension_token'"`)
      .toString()
      .trim();
  } catch {
    return '';
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function connectWithRetry() {
  for (let i = 0; i < 40; i++) {
    const token = readToken();
    if (token) {
      try {
        const ws = await new Promise((resolve, reject) => {
          const s = new WebSocket(`ws://127.0.0.1:${port}/`, {
            headers: { origin: 'chrome-extension://fakeext' },
          });
          s.once('open', () => resolve(s));
          s.once('error', reject);
        });
        return { ws, token };
      } catch {
        /* retry */
      }
    }
    await wait(500);
  }
  throw new Error('could not connect to Kestrel');
}

const { ws, token } = await connectWithRetry();
const log = (...a) => console.log('[fake-ext]', ...a);
ws.on('message', (d) => log('←', d.toString()));
ws.send(JSON.stringify({ type: 'hello', token, client: 'FakeChrome', version: '0.0.0' }));
await wait(300);
ws.send(
  JSON.stringify({ type: 'call', state: 'joined', url: 'https://meet.google.com/abc-defg-hij' }),
);
await wait(500);
ws.send(JSON.stringify({ type: 'capture', state: 'started' }));

// Stream audio: a file if given, else a 440 Hz tone so THEM levels move.
let sent = 0;
const chunk = 2560; // 80 ms
let pcm;
if (audioFile && existsSync(audioFile)) pcm = readFileSync(audioFile);
else {
  pcm = Buffer.alloc(16000 * 2 * 6);
  for (let i = 0; i < 16000 * 6; i++)
    pcm.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / 16000) * 8000), i * 2);
}
const timer = setInterval(() => {
  if (sent >= pcm.length) return;
  ws.send(pcm.subarray(sent, sent + chunk));
  sent += chunk;
}, 80);
await wait(1500);
ws.send(
  JSON.stringify({
    type: 'caption',
    speaker: 'Alice Interviewer',
    text: 'So, can you walk me through',
    ts: Date.now(),
    isFinal: false,
  }),
);
await wait(800);
ws.send(
  JSON.stringify({
    type: 'caption',
    speaker: 'Alice Interviewer',
    text: 'So, can you walk me through your most recent project?',
    ts: Date.now(),
    isFinal: true,
  }),
);
await wait(1200);
ws.send(
  JSON.stringify({
    type: 'caption',
    speaker: 'You',
    text: 'Sure, at my last company I led the migration to a new billing system.',
    ts: Date.now(),
    isFinal: true,
  }),
);
log('streamed captions; audio bytes sent so far', sent);
if (leaveAfter > 0) {
  await wait(leaveAfter);
  ws.send(JSON.stringify({ type: 'call', state: 'left' }));
  await wait(500);
  clearInterval(timer);
  ws.close();
  log('left call, closed');
  process.exit(0);
}
