import { WebSocketServer, type WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';

export interface FakeDgWord {
  word: string;
  start: number;
  end: number;
}

/**
 * Minimal stand-in for Deepgram's streaming endpoint. It records the audio bytes it
 * receives and lets a test script push Results / UtteranceEnd messages to clients.
 */
export class FakeDeepgramServer {
  private wss: WebSocketServer;
  clients: WebSocket[] = [];
  connections = 0;
  bytesReceived = 0;
  controlMessages: string[] = [];
  lastUrl = '';
  lastAuth = '';
  rejectAuth = false;

  private constructor(wss: WebSocketServer) {
    this.wss = wss;
    wss.on('connection', (ws, req) => {
      this.lastUrl = req.url ?? '';
      this.lastAuth = String(req.headers['authorization'] ?? '');
      this.connections++;
      this.clients.push(ws);
      ws.on('message', (data, isBinary) => {
        if (isBinary) this.bytesReceived += (data as Buffer).length;
        else this.controlMessages.push(data.toString());
      });
      ws.on('close', () => {
        this.clients = this.clients.filter((c) => c !== ws);
      });
    });
  }

  static async start(): Promise<FakeDeepgramServer> {
    let self: FakeDeepgramServer | null = null;
    const wss = new WebSocketServer({
      port: 0,
      host: '127.0.0.1',
      // Like the real API, bad credentials are rejected at the HTTP upgrade with 401.
      verifyClient: (info, cb) => {
        const auth = String(info.req.headers['authorization'] ?? '');
        if (self?.rejectAuth || !auth.startsWith('Token ')) cb(false, 401, 'Unauthorized');
        else cb(true);
      },
    });
    await new Promise<void>((r) => wss.once('listening', () => r()));
    self = new FakeDeepgramServer(wss);
    return self;
  }

  get url(): string {
    const { port } = this.wss.address() as AddressInfo;
    return `ws://127.0.0.1:${port}/v1/listen`;
  }

  private send(obj: unknown): void {
    for (const c of this.clients) if (c.readyState === c.OPEN) c.send(JSON.stringify(obj));
  }

  /** Emit a Results message. `start`/`end` in seconds of audio time. */
  results(text: string, opts: { isFinal?: boolean; speechFinal?: boolean; start?: number; end?: number } = {}): void {
    const start = opts.start ?? 0;
    const end = opts.end ?? start + Math.max(0.2, text.split(' ').length * 0.3);
    const words: FakeDgWord[] = text
      .split(' ')
      .filter(Boolean)
      .map((w, i, arr) => ({ word: w, start: start + ((end - start) * i) / arr.length, end: start + ((end - start) * (i + 1)) / arr.length }));
    this.send({
      type: 'Results',
      is_final: !!opts.isFinal,
      speech_final: !!opts.speechFinal,
      start,
      duration: end - start,
      channel: { alternatives: [{ transcript: text, confidence: 0.98, words }] },
    });
  }

  utteranceEnd(lastWordEnd: number): void {
    this.send({ type: 'UtteranceEnd', channel: [0, 1], last_word_end: lastWordEnd });
  }

  speechStarted(ts: number): void {
    this.send({ type: 'SpeechStarted', channel: [0, 1], timestamp: ts });
  }

  /** Drop every client connection (simulates network loss). */
  dropAll(): void {
    for (const c of this.clients) c.terminate();
    this.clients = [];
  }

  async close(): Promise<void> {
    this.dropAll();
    await new Promise<void>((r) => this.wss.close(() => r()));
  }
}

export const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
