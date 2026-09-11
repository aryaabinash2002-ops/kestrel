import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { FakeDeepgramServer, wait } from './fakes/fakeDeepgram';
import { DeepgramTranscriber, deepgramQuery } from '@main/transcription/DeepgramTranscriber';
import type { TranscriptResult } from '@shared/types/transcription';

let server: FakeDeepgramServer;
beforeEach(async () => {
  server = await FakeDeepgramServer.start();
});
afterEach(async () => {
  await server.close();
});

function make(): DeepgramTranscriber {
  return new DeepgramTranscriber({
    channel: 'THEM',
    apiKey: 'test-key',
    language: 'multi',
    sampleRate: 16000,
    endpoint: server.url,
  });
}

describe('DeepgramTranscriber', () => {
  it('uses the §5.1 low-latency query parameters', () => {
    const q = new URLSearchParams(deepgramQuery({ language: 'en', sampleRate: 16000 }));
    expect(q.get('model')).toBe('nova-3');
    expect(q.get('interim_results')).toBe('true');
    expect(q.get('endpointing')).toBe('300');
    expect(q.get('utterance_end_ms')).toBe('1000');
    expect(q.get('smart_format')).toBe('true');
    expect(q.get('punctuate')).toBe('true');
    expect(q.get('vad_events')).toBe('true');
    expect(q.get('encoding')).toBe('linear16');
    expect(q.get('sample_rate')).toBe('16000');
  });

  it('connects with the Token header, streams audio and maps results to wall-clock time', async () => {
    const t = make();
    const results: TranscriptResult[] = [];
    t.on('result', (r: TranscriptResult) => results.push(r));
    await t.connect();
    expect(t.status).toBe('open');
    expect(server.lastAuth).toBe('Token test-key');
    expect(server.lastUrl).toContain('model=nova-3');

    const before = Date.now();
    t.send(Buffer.alloc(3200)); // 100 ms of audio
    await wait(50);
    expect(server.bytesReceived).toBe(3200);

    server.results('what is your', { start: 0, end: 0.9 });
    server.results('What is your greatest strength?', {
      isFinal: true,
      speechFinal: true,
      start: 0,
      end: 1.8,
    });
    await wait(80);
    expect(results).toHaveLength(2);
    expect(results[0]?.isFinal).toBe(false);
    expect(results[1]?.isFinal).toBe(true);
    expect(results[1]?.speechFinal).toBe(true);
    expect(results[1]?.text).toBe('What is your greatest strength?');
    // audio time 1.8 s after the epoch (first send) → ~1800 ms after `before`
    expect(results[1]!.endWallMs - before).toBeGreaterThanOrEqual(1700);
    expect(results[1]!.endWallMs - before).toBeLessThan(2100);
    await t.close();
    expect(t.status).toBe('closed');
  });

  it('reconnects after the socket drops and replays buffered audio', async () => {
    const t = make();
    await t.connect();
    server.dropAll();
    await wait(30);
    expect(['reconnecting', 'connecting']).toContain(t.status);
    t.send(Buffer.alloc(1600)); // buffered while offline
    await wait(700); // first backoff is 500 ms
    expect(t.status).toBe('open');
    expect(server.connections).toBe(2);
    await wait(30);
    expect(server.bytesReceived).toBe(1600);
    await t.close();
  });

  it('sends KeepAlive when no audio flows', async () => {
    const t = make();
    await t.connect();
    // Pretend the last audio was long ago so the 2 s keep-alive tick fires immediately.
    (t as unknown as { lastAudioSentAt: number }).lastAudioSentAt = Date.now() - 10000;
    await wait(2200);
    expect(server.controlMessages.some((m) => m.includes('KeepAlive'))).toBe(true);
    await t.close();
    expect(server.controlMessages.some((m) => m.includes('CloseStream'))).toBe(true);
  });

  it('reports an error state on bad credentials', async () => {
    server.rejectAuth = true;
    const t = make();
    await expect(t.connect()).rejects.toBeTruthy();
    expect(t.status).toBe('error');
  });
});
