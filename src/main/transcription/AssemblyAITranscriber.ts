import WebSocket from 'ws';
import type { TranscriptResult, TranscriptWord } from '@shared/types/transcription';
import { BaseTranscriber, type TranscriberOptions } from './ITranscriber';

interface AaiWord {
  text: string;
  start: number; // ms
  end: number; // ms
  confidence: number;
  word_is_final: boolean;
}
interface AaiTurn {
  type: 'Turn';
  turn_order: number;
  turn_is_formatted: boolean;
  end_of_turn: boolean;
  transcript: string;
  end_of_turn_confidence: number;
  words: AaiWord[];
}
type AaiMessage =
  | AaiTurn
  | { type: 'Begin'; id: string }
  | { type: 'Termination' }
  | { type: 'Error'; error?: string };

export const ASSEMBLYAI_DEFAULT_ENDPOINT = 'wss://streaming.assemblyai.com/v3/ws';

/**
 * AssemblyAI Universal Streaming (v3). Turn-based: `transcript` is the whole turn so far,
 * `end_of_turn` marks the final; with format_turns a formatted copy follows.
 */
export class AssemblyAITranscriber extends BaseTranscriber {
  readonly provider = 'assemblyai';
  private ws: WebSocket | null = null;
  private pendingFinal: { turn: AaiTurn; timer: NodeJS.Timeout } | null = null;

  constructor(opts: TranscriberOptions) {
    super(opts);
  }

  protected openSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      const q = new URLSearchParams({
        sample_rate: String(this.opts.sampleRate),
        encoding: 'pcm_s16le',
        format_turns: 'true',
        end_of_turn_confidence_threshold: '0.6',
        min_end_of_turn_silence_when_confident: '300',
        max_turn_silence: '1000',
      });
      const url = `${this.opts.endpoint ?? ASSEMBLYAI_DEFAULT_ENDPOINT}?${q.toString()}`;
      const ws = new WebSocket(url, { headers: { Authorization: this.opts.apiKey } });
      this.ws = ws;
      this.bytesSent = 0;
      let settled = false;
      ws.on('open', () => {
        settled = true;
        resolve();
      });
      ws.on('message', (data) => this.onMessage(data.toString()));
      ws.on('error', (err) => {
        if (!settled) {
          settled = true;
          reject(err);
        }
      });
      ws.on('unexpected-response', (_req, res) => {
        if (!settled) {
          settled = true;
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
      ws.on('close', (code, reason) => {
        if (this.ws === ws) this.ws = null;
        if (!settled) {
          settled = true;
          reject(new Error(`closed ${code}`));
          return;
        }
        this.onSocketClosed(`${code} ${reason.toString()}`.trim());
      });
    });
  }

  private emitTurn(turn: AaiTurn, isFinal: boolean): void {
    const text = (turn.transcript ?? '').trim();
    if (!text) return;
    const words: TranscriptWord[] = (turn.words ?? []).map((w) => ({
      word: w.text,
      startWallMs: this.toWallMs(w.start / 1000),
      endWallMs: this.toWallMs(w.end / 1000),
    }));
    const first = turn.words?.[0];
    const last = turn.words?.[turn.words.length - 1];
    const result: TranscriptResult = {
      channel: this.channel,
      text,
      isFinal,
      speechFinal: isFinal,
      startWallMs: first ? this.toWallMs(first.start / 1000) : Date.now(),
      endWallMs: last ? this.toWallMs(last.end / 1000) : Date.now(),
      receivedAt: Date.now(),
      words,
    };
    this.emit('result', result);
    if (isFinal) this.emit('utteranceEnd', result.endWallMs);
  }

  private onMessage(raw: string): void {
    let msg: AaiMessage;
    try {
      msg = JSON.parse(raw) as AaiMessage;
    } catch {
      return;
    }
    if (msg.type === 'Turn') {
      if (!msg.end_of_turn) {
        this.emitTurn(msg, false);
        return;
      }
      if (msg.turn_is_formatted) {
        if (this.pendingFinal) {
          clearTimeout(this.pendingFinal.timer);
          this.pendingFinal = null;
        }
        this.emitTurn(msg, true);
        return;
      }
      // Unformatted end-of-turn: wait briefly for the formatted copy, else finalize as-is.
      if (this.pendingFinal) clearTimeout(this.pendingFinal.timer);
      this.pendingFinal = {
        turn: msg,
        timer: setTimeout(() => {
          const p = this.pendingFinal;
          this.pendingFinal = null;
          if (p) this.emitTurn(p.turn, true);
        }, 400),
      };
    } else if (msg.type === 'Error') {
      this.log.warn('assemblyai error', msg.error ?? raw);
    }
  }

  protected sendAudio(pcm: Buffer): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(pcm);
  }

  protected sendKeepAlive(): void {
    // AssemblyAI has no keep-alive message; send 100 ms of silence instead.
    if (this.ws?.readyState === WebSocket.OPEN)
      this.ws.send(Buffer.alloc((this.opts.sampleRate * 2) / 10));
  }

  finalize(): void {
    if (this.ws?.readyState === WebSocket.OPEN)
      this.ws.send(JSON.stringify({ type: 'ForceEndpoint' }));
  }

  protected closeSocket(): Promise<void> {
    return new Promise((resolve) => {
      const ws = this.ws;
      this.ws = null;
      if (this.pendingFinal) clearTimeout(this.pendingFinal.timer);
      this.pendingFinal = null;
      if (!ws) return resolve();
      ws.once('close', () => resolve());
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'Terminate' }));
          setTimeout(() => ws.terminate(), 1500);
        } else ws.terminate();
      } catch {
        resolve();
      }
      setTimeout(resolve, 2000);
    });
  }
}
