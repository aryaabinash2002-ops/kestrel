/**
 * Offscreen document: owns the tab-capture MediaStream, the audio graph, and the
 * WebSocket to the Kestrel desktop app. Audio is routed back to the speakers so the
 * user keeps hearing the call (tabCapture mutes the tab otherwise).
 */
import type { AppToExtensionMessage, ExtensionToAppMessage } from '@shared/types/extension';
import type { ExtMessage, ExtStatus } from './protocol';

const VERSION = chrome.runtime.getManifest().version;
const SAMPLE_RATE = 16000;

let ws: WebSocket | null = null;
let wsToken = '';
let wsPort = 0;
let reconnectTimer: number | null = null;
let reconnectDelay = 1000;
let stream: MediaStream | null = null;
let ctx: AudioContext | null = null;
let node: AudioWorkletNode | null = null;
let capturing = false;
let pingTimer: number | null = null;

function report(status: Partial<ExtStatus>): void {
  void chrome.runtime.sendMessage({ type: 'offscreen-status', status } satisfies ExtMessage).catch(() => undefined);
}

function sendJson(msg: ExtensionToAppMessage): void {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function connect(token: string, port: number): void {
  wsToken = token;
  wsPort = port;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  report({ connection: 'connecting', lastError: null });
  const socket = new WebSocket(`ws://127.0.0.1:${port}/`);
  socket.binaryType = 'arraybuffer';
  ws = socket;
  socket.onopen = () => {
    reconnectDelay = 1000;
    sendJson({ type: 'hello', token, client: navigator.userAgent.includes('Edg/') ? 'Edge' : navigator.userAgent.includes('Brave') ? 'Brave' : 'Chrome', version: VERSION });
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = setInterval(() => sendJson({ type: 'ping', ts: Date.now() }), 10000) as unknown as number;
  };
  socket.onmessage = (ev) => {
    if (typeof ev.data !== 'string') return;
    let msg: AppToExtensionMessage;
    try {
      msg = JSON.parse(ev.data) as AppToExtensionMessage;
    } catch {
      return;
    }
    if (msg.type === 'welcome') {
      report({ connection: 'connected', appVersion: msg.appVersion, sessionActive: msg.sessionActive, lastError: null });
      if (capturing) sendJson({ type: 'capture', state: 'started' });
    } else if (msg.type === 'error') {
      report({ connection: msg.code === 'bad-token' ? 'bad-token' : 'error', lastError: msg.message });
      if (msg.code === 'bad-token') {
        wsToken = '';
        socket.close();
      }
    }
    void chrome.runtime.sendMessage({ type: 'app-message', message: msg } satisfies ExtMessage).catch(() => undefined);
  };
  socket.onclose = () => {
    if (ws === socket) ws = null;
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = null;
    report({ connection: wsToken ? 'disconnected' : 'bad-token' });
    if (wsToken && (capturing || reconnectTimer === null)) scheduleReconnect();
  };
  socket.onerror = () => {
    /* onclose follows */
  };
}

function scheduleReconnect(): void {
  if (reconnectTimer !== null || !wsToken) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (wsToken) connect(wsToken, wsPort);
  }, reconnectDelay) as unknown as number;
  reconnectDelay = Math.min(reconnectDelay * 2, 15000);
}

async function start(streamId: string, token: string, port: number): Promise<void> {
  await stop(false);
  connect(token, port);
  stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      // Chrome-specific constraints for tab capture.
      mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId },
    } as unknown as MediaTrackConstraints,
    video: false,
  });
  ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  await ctx.audioWorklet.addModule(chrome.runtime.getURL('worklet.js'));
  const source = ctx.createMediaStreamSource(stream);
  // Keep playing the call to the user.
  source.connect(ctx.destination);
  node = new AudioWorkletNode(ctx, 'pcm-capture', {
    numberOfInputs: 1,
    numberOfOutputs: 0,
    channelCount: 1,
    channelCountMode: 'explicit',
    processorOptions: { chunkSize: Math.round(SAMPLE_RATE * 0.08) },
  });
  node.port.onmessage = (ev: MessageEvent<{ type: 'chunk'; pcm: ArrayBuffer }>) => {
    if (ev.data.type === 'chunk' && ws?.readyState === WebSocket.OPEN) ws.send(ev.data.pcm);
  };
  source.connect(node);
  for (const t of stream.getAudioTracks()) t.addEventListener('ended', () => void stop(true));
  capturing = true;
  sendJson({ type: 'capture', state: 'started' });
  report({ capturing: true, lastError: null });
}

async function stop(closeSocket: boolean): Promise<void> {
  if (capturing) sendJson({ type: 'capture', state: 'stopped' });
  capturing = false;
  node?.disconnect();
  node = null;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  await ctx?.close().catch(() => undefined);
  ctx = null;
  report({ capturing: false });
  if (closeSocket) {
    wsToken = '';
    ws?.close();
    ws = null;
  }
}

chrome.runtime.onMessage.addListener((msg: ExtMessage, _sender, reply) => {
  switch (msg.type) {
    case 'offscreen-start':
      start(msg.streamId, msg.token, msg.port)
        .then(() => reply({ ok: true }))
        .catch((err: Error) => {
          report({ capturing: false, lastError: err.message });
          reply({ ok: false, error: err.message });
        });
      return true;
    case 'offscreen-stop':
      void stop(true).then(() => reply({ ok: true }));
      return true;
    case 'offscreen-connect':
      connect(msg.token, msg.port);
      reply({ ok: true });
      return false;
    case 'offscreen-forward':
      sendJson(msg.payload as ExtensionToAppMessage);
      return false;
    default:
      return false;
  }
});
