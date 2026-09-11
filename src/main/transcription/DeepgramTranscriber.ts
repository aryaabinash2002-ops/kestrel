import WebSocket from 'ws';
import type { TranscriptResult, TranscriptWord } from '@shared/types/transcription';
import { BaseTranscriber, type TranscriberOptions } from './ITranscriber';

interface DgWord {
  word: string;
  punctuated_word?: string;
  start: number;
  end: number;
  confidence: number;
}
interface DgResults {
  type: 'Results';
  is_final: boolean;
  speech_final: boolean;
  start: number;
  duration: number;
  channel: { alternatives: { transcript: string; confidence: number; words: DgWord[] }[] };
  from_finalize?: boolean;
}
interface DgUtteranceEnd {
  type: 'UtteranceEnd';
  last_word_end: number;
}
interface DgSpeechStarted {
  type: 'SpeechStarted';
  timestamp: number;
}
type DgMessage =
  | DgResults
  | DgUtteranceEnd
  | DgSpeechStarted
  | { type: 'Metadata' }
  | { type: 'Error'; message?: string };

export const DEEPGRAM_DEFAULT_ENDPOINT = 'wss://api.deepgram.com/v1/listen';

/** Query string per spec §5.1 — exported so tests can assert on it. */
export function deepgramQuery(opts: {
  language: string;
  sampleRate: number;
  keyterms?: string[];
}): string {
  const q = new URLSearchParams({
    model: 'nova-3',
    encoding: 'linear16',
    sample_rate: String(opts.sampleRate),
    channels: '1',
    interim_results: 'true',
    // §5.1 defaults; KESTREL_DG_ENDPOINTING / KESTREL_DG_UTTERANCE_END allow latency tuning experiments.
    endpointing: process.env['KESTREL_DG_ENDPOINTING'] || '200',
    utterance_end_ms: process.env['KESTREL_DG_UTTERANCE_END'] || '1000',
    smart_format: 'true',
    punctuate: 'true',
    vad_events: 'true',
    language: opts.language || 'multi',
  });
  for (const k of opts.keyterms ?? []) q.append('keyterm', k);
  return q.toString();
}

/**
 * Deepgram streaming (nova-3). Binary PCM16 in, JSON results out.
 * Finals are per segment; `speech_final` marks the end of an utterance.
 */
export class DeepgramTranscriber extends BaseTranscriber {
  readonly provider = 'deepgram';
  private ws: WebSocket | null = null;

  constructor(opts: TranscriberOptions) {
    super(opts);
  }

  protected openSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `${this.opts.endpoint ?? DEEPGRAM_DEFAULT_ENDPOINT}?${deepgramQuery(this.opts)}`;
      const ws = new WebSocket(url, { headers: { Authorization: `Token ${this.opts.apiKey}` } });
      this.ws = ws;
      this.bytesSent = 0;
      let settled = false;
      ws.on('open', () => {
        settled = true;
        resolve();
      });
      ws.on('message', (data) => this.onMessage(data.toString()));
      ws.on('error', (err) => {
        this.log.debug('deepgram ws error', err.message);
        if (!settled) {
          settled = true;
          reject(err);
        }
      });
      ws.on('unexpected-response', (_req, res) => {
        const err = new Error(`HTTP ${res.statusCode} ${res.statusMessage ?? ''}`.trim());
        if (!settled) {
          settled = true;
          reject(err);
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

  private onMessage(raw: string): void {
    let msg: DgMessage;
    try {
      msg = JSON.parse(raw) as DgMessage;
    } catch {
      return;
    }
    const receivedAt = Date.now();
    switch (msg.type) {
      case 'Results': {
        const alt = msg.channel?.alternatives?.[0];
        if (!alt) return;
        const text = (alt.transcript ?? '').trim();
        if (!text && !msg.is_final) return;
        const words: TranscriptWord[] = (alt.words ?? []).map((w) => ({
          word: w.punctuated_word ?? w.word,
          startWallMs: this.toWallMs(w.start),
          endWallMs: this.toWallMs(w.end),
        }));
        const lastWordEnd = alt.words?.length
          ? alt.words[alt.words.length - 1]!.end
          : msg.start + msg.duration;
        const result: TranscriptResult = {
          channel: this.channel,
          text,
          isFinal: msg.is_final,
          speechFinal: !!msg.speech_final,
          startWallMs: this.toWallMs(msg.start),
          endWallMs: this.toWallMs(lastWordEnd),
          receivedAt,
          words,
        };
        this.emit('result', result);
        break;
      }
      case 'UtteranceEnd':
        this.emit('utteranceEnd', this.toWallMs(msg.last_word_end));
        break;
      case 'SpeechStarted':
        this.emit('speechStarted', this.toWallMs(msg.timestamp));
        break;
      case 'Error':
        this.log.warn('deepgram error message', msg.message ?? raw);
        break;
      default:
        break;
    }
  }

  protected sendAudio(pcm: Buffer): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(pcm);
  }

  protected sendKeepAlive(): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'KeepAlive' }));
  }

  finalize(): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'Finalize' }));
  }

  protected closeSocket(): Promise<void> {
    return new Promise((resolve) => {
      const ws = this.ws;
      this.ws = null;
      if (!ws) return resolve();
      const done = () => resolve();
      ws.once('close', done);
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'CloseStream' }));
          setTimeout(() => ws.terminate(), 1500);
        } else ws.terminate();
      } catch {
        resolve();
      }
      setTimeout(done, 2000);
    });
  }
}
