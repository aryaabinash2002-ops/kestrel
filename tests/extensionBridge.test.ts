import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { on: () => {}, handle: () => {}, removeHandler: () => {} },
}));

const { ExtensionBridge } = await import('@main/extension/ExtensionBridge');

let token: string | null = null;
let bridge: InstanceType<typeof ExtensionBridge>;

beforeEach(async () => {
  token = null;
  bridge = new ExtensionBridge({
    getPort: () => 47700 + Math.floor(Math.random() * 200),
    getToken: () => token,
    setToken: (t) => (token = t),
    appVersion: '0.1.0-test',
    isSessionActive: () => true,
  });
  await bridge.start();
});
afterEach(async () => {
  await bridge.stop();
});

function connect(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(bridge.pairing().url, {
      headers: { origin: 'chrome-extension://abcdefg' },
    });
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}
function next(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve) => ws.once('message', (d) => resolve(JSON.parse(d.toString()))));
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('ExtensionBridge', () => {
  it('pairs with the token, streams audio and relays call/caption events', async () => {
    const pairing = bridge.pairing();
    expect(pairing.token).toMatch(/^KES-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    const audio: Buffer[] = [];
    const calls: string[] = [];
    const captions: unknown[] = [];
    bridge.on('audio', (b: Buffer) => audio.push(b));
    bridge.on('call', (s: string) => calls.push(s));
    bridge.on('caption', (c: unknown) => captions.push(c));

    const ws = await connect();
    const welcome = next(ws);
    ws.send(
      JSON.stringify({ type: 'hello', token: pairing.token, client: 'Chrome', version: '0.1.0' }),
    );
    expect(await welcome).toMatchObject({
      type: 'welcome',
      appVersion: '0.1.0-test',
      sessionActive: true,
    });
    expect(bridge.state().status).toBe('paired');

    ws.send(JSON.stringify({ type: 'capture', state: 'started' }));
    ws.send(Buffer.alloc(2560));
    ws.send(
      JSON.stringify({
        type: 'call',
        state: 'joined',
        url: 'https://meet.google.com/abc-defg-hij',
      }),
    );
    ws.send(
      JSON.stringify({
        type: 'caption',
        speaker: 'Alice',
        text: 'Tell me about yourself',
        ts: Date.now(),
        isFinal: true,
      }),
    );
    await wait(60);
    expect(audio).toHaveLength(1);
    expect(audio[0]?.length).toBe(2560);
    expect(bridge.state().status).toBe('capturing');
    expect(bridge.state().inCall).toBe(true);
    expect(bridge.state().captionsAvailable).toBe(true);
    expect(calls).toEqual(['joined']);
    expect(captions).toHaveLength(1);

    const pong = next(ws);
    ws.send(JSON.stringify({ type: 'ping', ts: 123 }));
    expect(await pong).toMatchObject({ type: 'pong', ts: 123 });

    const sess = next(ws);
    bridge.notifySession(false);
    expect(await sess).toMatchObject({ type: 'session', active: false });

    ws.close();
    await wait(60);
    expect(bridge.state().status).toBe('listening');
    expect(bridge.state().inCall).toBe(false);
  });

  it('rejects a wrong token', async () => {
    bridge.pairing();
    const ws = await connect();
    const err = next(ws);
    ws.send(
      JSON.stringify({ type: 'hello', token: 'KES-NOPE-NOPE', client: 'Chrome', version: '0.1.0' }),
    );
    expect(await err).toMatchObject({ type: 'error', code: 'bad-token' });
    await wait(50);
    expect(ws.readyState).toBe(WebSocket.CLOSED);
    expect(bridge.state().status).toBe('listening');
  });

  it('ignores audio before pairing and rejects foreign origins', async () => {
    const audio: Buffer[] = [];
    bridge.on('audio', (b: Buffer) => audio.push(b));
    const ws = await connect();
    ws.send(Buffer.alloc(100));
    await wait(30);
    expect(audio).toHaveLength(0);
    ws.close();

    const bad = new WebSocket(bridge.pairing().url, {
      headers: { origin: 'https://evil.example' },
    });
    const closed = new Promise<number>((r) => bad.once('close', (code) => r(code)));
    bad.once('error', () => undefined);
    expect(await closed).toBe(1008);
  });
});
