/**
 * Hidden capture renderer. Owns the MediaStreams and Web Audio graph for both
 * channels and ships PCM16 16 kHz chunks to the main process over IPC.
 *
 *   ME   = microphone (getUserMedia, echoCancellation/noiseSuppression/AGC on)
 *   THEM = system loopback (getDisplayMedia + main-process loopback handler)
 *          or a virtual input device (BlackHole / VB-Cable) via getUserMedia
 */
import type { AudioDevice, AudioDevices, CaptureCommand } from '@shared/types/audio';
import { PCM_CHUNK_MS, PCM_SAMPLE_RATE } from '@shared/types/audio';
import { WORKLET_SOURCE } from './worklet-source';

type Channel = 'ME' | 'THEM';

interface ChannelGraph {
  stream: MediaStream;
  ctx: AudioContext;
  source: MediaStreamAudioSourceNode;
  node: AudioWorkletNode;
  label: string;
  lastNonSilentAt: number;
  silentWarned: boolean;
  levelTimer: number;
  lastLevel: number;
}

const graphs: Partial<Record<Channel, ChannelGraph>> = {};
const logEl = document.getElementById('log');
let workletUrl: string | null = null;

const t0 = performance.now();
function log(message: string): void {
  const line = `+${(performance.now() - t0).toFixed(0).padStart(6)}ms ${message}`;
  if (logEl) {
    logEl.textContent = (logEl.textContent + line + '\n').split('\n').slice(-40).join('\n');
  }
  window.kestrelCapture.event({ type: 'log', message });
}

function getWorkletUrl(): string {
  if (!workletUrl) {
    workletUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));
  }
  return workletUrl;
}

async function listDevices(): Promise<AudioDevices> {
  const all = await navigator.mediaDevices.enumerateDevices();
  const map = (d: MediaDeviceInfo): AudioDevice => ({
    deviceId: d.deviceId,
    label: d.label,
    kind: d.kind as AudioDevice['kind'],
    groupId: d.groupId,
  });
  const inputs = all.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications').map(map);
  const outputs = all.filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default' && d.deviceId !== 'communications').map(map);
  // If labels are empty we have never been granted mic access — try once so pickers show names.
  if (inputs.length && inputs.every((d) => !d.label)) {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
      return listDevices();
    } catch {
      /* permission denied — return unlabeled devices */
    }
  }
  return { inputs, outputs };
}

function isBluetoothHeadset(track: MediaStreamTrack): boolean {
  const label = track.label.toLowerCase();
  const settings = track.getSettings();
  const lowRate = typeof settings.sampleRate === 'number' && settings.sampleRate > 0 && settings.sampleRate <= 16000;
  const btName = /airpods|bluetooth|hands-free|\bbt\b|buds|headset/.test(label);
  return btName && lowRate;
}

async function attach(channel: Channel, stream: MediaStream, label: string): Promise<void> {
  await detach(channel);
  const ctx = new AudioContext({ sampleRate: PCM_SAMPLE_RATE, latencyHint: 'interactive' });
  log(`${channel} context state ${ctx.state}`);
  await ctx.audioWorklet.addModule(getWorkletUrl());
  log(`${channel} worklet loaded`);
  const source = ctx.createMediaStreamSource(stream);
  const chunkSize = Math.round((PCM_SAMPLE_RATE * PCM_CHUNK_MS) / 1000);
  const node = new AudioWorkletNode(ctx, 'pcm-capture', {
    numberOfInputs: 1,
    numberOfOutputs: 0,
    channelCount: 1,
    channelCountMode: 'explicit',
    channelInterpretation: 'speakers',
    processorOptions: { chunkSize },
  });
  const graph: ChannelGraph = {
    stream,
    ctx,
    source,
    node,
    label,
    lastNonSilentAt: performance.now(),
    silentWarned: false,
    levelTimer: 0,
    lastLevel: 0,
  };
  node.port.onmessage = (ev: MessageEvent<{ type: 'chunk'; pcm: ArrayBuffer; rms: number; peak: number }>) => {
    const msg = ev.data;
    if (msg.type !== 'chunk') return;
    window.kestrelCapture.pcm(channel, Date.now(), msg.pcm);
    // Level: dBFS meter, -50 dB → 0, -10 dB → 1 (speech lands around 0.4–0.8).
    const db = 20 * Math.log10(Math.max(msg.rms, 1e-6));
    const level = Math.min(1, Math.max(0, (db + 50) / 40));
    graph.lastLevel = Math.max(level, graph.lastLevel * 0.7);
    if (msg.peak > 0.004) {
      graph.lastNonSilentAt = performance.now();
      if (graph.silentWarned) {
        graph.silentWarned = false;
        window.kestrelCapture.event({ type: 'warning', channel, warning: 'signal-restored' });
      }
    }
  };
  source.connect(node);
  graph.levelTimer = window.setInterval(() => {
    window.kestrelCapture.event({ type: 'level', channel, level: graph.lastLevel });
    graph.lastLevel *= 0.5;
    if (!graph.silentWarned && performance.now() - graph.lastNonSilentAt > 6000) {
      graph.silentWarned = true;
      window.kestrelCapture.event({ type: 'warning', channel, warning: 'no-signal' });
    }
  }, 80);
  for (const track of stream.getAudioTracks()) {
    track.addEventListener('ended', () => {
      window.kestrelCapture.event({ type: 'trackEnded', channel, reason: 'track ended' });
      void detach(channel);
    });
  }
  graphs[channel] = graph;
  await ctx.resume();
  log(`${channel} attached: ${label} (ctx ${ctx.sampleRate} Hz, chunk ${chunkSize})`);
}

async function detach(channel: Channel): Promise<void> {
  const g = graphs[channel];
  if (!g) return;
  delete graphs[channel];
  clearInterval(g.levelTimer);
  try {
    g.source.disconnect();
    g.node.disconnect();
    g.node.port.onmessage = null;
  } catch {
    /* ignore */
  }
  g.stream.getTracks().forEach((t) => t.stop());
  await g.ctx.close().catch(() => undefined);
  window.kestrelCapture.event({ type: 'level', channel, level: 0 });
  log(`${channel} detached`);
}

async function startMic(deviceId: string | null): Promise<{ label: string; warnings: string[] }> {
  const constraints: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
  };
  if (deviceId) constraints.deviceId = { exact: deviceId };
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: constraints });
  } catch (err) {
    if (deviceId && err instanceof Error && (err.name === 'OverconstrainedError' || err.name === 'NotFoundError')) {
      // Device unplugged — fall back to default.
      stream = await navigator.mediaDevices.getUserMedia({ audio: { ...constraints, deviceId: undefined } });
    } else throw err;
  }
  log(`mic stream acquired (${stream.getAudioTracks().length} tracks)`);
  const track = stream.getAudioTracks()[0];
  if (!track) throw new Error('No microphone track');
  const warnings: string[] = [];
  if (isBluetoothHeadset(track)) warnings.push('bluetooth-headset');
  await attach('ME', stream, track.label || 'Microphone');
  return { label: track.label || 'Microphone', warnings };
}

async function startLoopback(): Promise<{ label: string; warnings: string[] }> {
  // Electron routes this through session.setDisplayMediaRequestHandler → audio: 'loopback'.
  const stream = await navigator.mediaDevices.getDisplayMedia({
    audio: true,
    video: { width: 2, height: 2, frameRate: 1 },
  });
  log(`display stream acquired (audio ${stream.getAudioTracks().length}, video ${stream.getVideoTracks().length})`);
  stream.getVideoTracks().forEach((t) => {
    t.stop();
    stream.removeTrack(t);
  });
  const track = stream.getAudioTracks()[0];
  if (!track) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error('no-system-audio');
  }
  if (track.readyState === 'ended') {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error('system-audio-permission');
  }
  await attach('THEM', stream, 'System audio');
  return { label: 'System audio', warnings: [] };
}

async function startDevice(deviceId: string): Promise<{ label: string; warnings: string[] }> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: { exact: deviceId },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });
  const track = stream.getAudioTracks()[0];
  if (!track) throw new Error('No input track');
  await attach('THEM', stream, track.label || 'Virtual device');
  return { label: track.label || 'Virtual device', warnings: [] };
}

async function run(cmd: CaptureCommand): Promise<unknown> {
  log(`cmd ${cmd.type}`);
  switch (cmd.type) {
    case 'ping':
      return 'pong';
    case 'listDevices':
      return listDevices();
    case 'startMic':
      return startMic(cmd.deviceId);
    case 'stopMic':
      await detach('ME');
      return true;
    case 'startLoopback':
      return startLoopback();
    case 'startDevice':
      return startDevice(cmd.deviceId);
    case 'stopSystem':
      await detach('THEM');
      return true;
    default:
      throw new Error(`unknown command`);
  }
}

window.kestrelCapture.onRequest(async (req) => {
  try {
    const result = await run(req.cmd);
    window.kestrelCapture.reply({ id: req.id, ok: true, result });
  } catch (err) {
    const e = err as Error & { name?: string };
    const message = e?.name && e.name !== 'Error' ? `${e.name}: ${e.message}` : (e?.message ?? String(err));
    log(`command ${req.cmd.type} failed: ${message}`);
    window.kestrelCapture.reply({ id: req.id, ok: false, error: message });
  }
});

navigator.mediaDevices.addEventListener('devicechange', () => window.kestrelCapture.event({ type: 'devicechange' }));

log('capture renderer ready');
