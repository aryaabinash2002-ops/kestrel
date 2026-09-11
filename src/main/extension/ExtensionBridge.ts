import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import type { AppToExtensionMessage, ExtensionPairingInfo, ExtensionState, ExtensionToAppMessage } from '@shared/types/extension';
import { emit } from '../ipc';
import { logger } from '../logger';

const log = logger.scope('extension');
const HELLO_TIMEOUT_MS = 5000;

export interface BridgeDeps {
  getPort: () => number;
  getToken: () => string | null;
  setToken: (t: string) => void;
  appVersion: string;
  isSessionActive: () => boolean;
}

/**
 * Local WebSocket server the Chrome extension connects to (ws://127.0.0.1:<port>).
 * First message must be `hello` with the pairing token; afterwards binary frames are
 * PCM16 16 kHz mono audio from the Meet tab and JSON frames are control/caption messages.
 *
 * Events: 'audio' (pcm: Buffer, ts), 'capture' (started: boolean), 'call' ('joined'|'left', url),
 *         'caption' ({speaker, text, ts, isFinal}), 'state' (ExtensionState)
 */
export class ExtensionBridge extends EventEmitter {
  private wss: WebSocketServer | null = null;
  private client: WebSocket | null = null;
  private port = 0;
  private status: ExtensionState['status'] = 'off';
  private clientName: string | null = null;
  private inCall = false;
  private captionsAvailable = false;
  private lastAudioAt: number | null = null;
  private captionsTimer: NodeJS.Timeout | null = null;

  constructor(private deps: BridgeDeps) {
    super();
  }

  state(): ExtensionState {
    return {
      status: this.status,
      clientName: this.clientName,
      inCall: this.inCall,
      captionsAvailable: this.captionsAvailable,
      lastAudioAt: this.lastAudioAt,
      port: this.port,
    };
  }

  pairing(): ExtensionPairingInfo {
    let token = this.deps.getToken();
    if (!token) token = this.regenerateToken();
    return { port: this.port || this.deps.getPort(), token, url: `ws://127.0.0.1:${this.port || this.deps.getPort()}/` };
  }

  regenerateToken(): string {
    const raw = randomBytes(6).toString('base64url').replace(/[-_]/g, 'x').toUpperCase().slice(0, 8);
    const token = `KES-${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
    this.deps.setToken(token);
    if (this.client) this.client.close(4001, 'token changed');
    return token;
  }

  async start(): Promise<void> {
    if (this.wss) return;
    if (!this.deps.getToken()) this.regenerateToken();
    const base = this.deps.getPort();
    for (let i = 0; i < 6; i++) {
      const port = base + i;
      try {
        await this.listen(port);
        this.port = port;
        this.setStatus('listening');
        log.info('listening on', port);
        return;
      } catch (err) {
        log.warn(`port ${port} unavailable`, err);
      }
    }
    log.error('could not bind extension bridge port');
    this.setStatus('off');
  }

  private listen(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({ host: '127.0.0.1', port, maxPayload: 1024 * 1024 });
      wss.once('listening', () => {
        this.wss = wss;
        wss.on('connection', (ws, req) => this.onConnection(ws, String(req.headers['origin'] ?? '')));
        resolve();
      });
      wss.once('error', (err) => reject(err));
    });
  }

  private onConnection(ws: WebSocket, origin: string): void {
    // Only browser extensions (chrome-extension://…) or local tools; never remote pages.
    if (origin && !/^chrome-extension:\/\//.test(origin) && !/^(https?:\/\/)?(localhost|127\.0\.0\.1)/.test(origin)) {
      log.warn('rejected origin', origin);
      ws.close(1008, 'origin');
      return;
    }
    let authed = false;
    const helloTimer = setTimeout(() => {
      if (!authed) ws.close(4000, 'hello timeout');
    }, HELLO_TIMEOUT_MS);

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        if (!authed || this.client !== ws) return;
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
        this.lastAudioAt = Date.now();
        if (this.status !== 'capturing') this.setStatus('capturing');
        this.emit('audio', buf, this.lastAudioAt);
        return;
      }
      let msg: ExtensionToAppMessage;
      try {
        msg = JSON.parse(data.toString()) as ExtensionToAppMessage;
      } catch {
        return;
      }
      if (!authed) {
        if (msg.type !== 'hello') return;
        const expected = this.deps.getToken();
        if (!expected || msg.token !== expected) {
          this.send(ws, { type: 'error', code: 'bad-token', message: 'Pairing token does not match. Copy it from Kestrel → Settings → Audio.' });
          ws.close(4003, 'bad token');
          return;
        }
        if (this.client && this.client !== ws && this.client.readyState === this.client.OPEN) {
          // Newest connection wins (e.g. browser restarted); tell the old one.
          this.send(this.client, { type: 'error', code: 'busy', message: 'Another extension instance connected.' });
          this.client.close(4002, 'replaced');
        }
        authed = true;
        clearTimeout(helloTimer);
        this.client = ws;
        this.clientName = `${msg.client} · ext ${msg.version}`;
        this.setStatus('paired');
        this.send(ws, { type: 'welcome', appVersion: this.deps.appVersion, sessionActive: this.deps.isSessionActive() });
        log.info('extension paired:', this.clientName);
        return;
      }
      if (this.client !== ws) return;
      switch (msg.type) {
        case 'ping':
          this.send(ws, { type: 'pong', ts: msg.ts });
          break;
        case 'capture':
          this.setStatus(msg.state === 'started' ? 'capturing' : 'paired');
          this.emit('capture', msg.state === 'started');
          break;
        case 'call':
          this.inCall = msg.state === 'joined';
          this.broadcastState();
          this.emit('call', msg.state, msg.url ?? '');
          break;
        case 'caption':
          this.captionsAvailable = true;
          if (this.captionsTimer) clearTimeout(this.captionsTimer);
          this.captionsTimer = setTimeout(() => {
            this.captionsAvailable = false;
            this.broadcastState();
          }, 15000);
          this.emit('caption', { speaker: msg.speaker, text: msg.text, ts: msg.ts, isFinal: msg.isFinal });
          break;
        default:
          break;
      }
    });

    ws.on('close', () => {
      clearTimeout(helloTimer);
      if (this.client === ws) {
        this.client = null;
        this.clientName = null;
        this.inCall = false;
        this.captionsAvailable = false;
        this.setStatus('listening');
        this.emit('capture', false);
        log.info('extension disconnected');
      }
    });
    ws.on('error', (err) => log.debug('client error', err.message));
  }

  private send(ws: WebSocket, msg: AppToExtensionMessage): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }

  /** Tell the extension whether a Kestrel session is running (it auto-starts capture on join). */
  notifySession(active: boolean): void {
    if (this.client) this.send(this.client, { type: 'session', active });
  }

  requestCapture(start: boolean): void {
    if (this.client) this.send(this.client, { type: 'request-capture', start });
  }

  get connected(): boolean {
    return !!this.client;
  }

  private setStatus(s: ExtensionState['status']): void {
    this.status = s;
    this.broadcastState();
  }

  private broadcastState(): void {
    const st = this.state();
    emit('extension:state', st);
    this.emit('state', st);
  }

  async stop(): Promise<void> {
    this.client?.close(1001, 'app closing');
    this.client = null;
    await new Promise<void>((r) => (this.wss ? this.wss.close(() => r()) : r()));
    this.wss = null;
    this.setStatus('off');
  }
}
