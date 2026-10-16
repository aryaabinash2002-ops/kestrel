import { describe, expect, it } from 'vitest';
import { hedged } from '../src/main/llm/hedge';

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(signal.reason ?? new Error('aborted'));
    });
  });

describe('hedged()', () => {
  it('returns the first attempt when it is fast', async () => {
    let starts = 0;
    const out: string[] = [];
    const r = await hedged(
      async (_s, emit) => {
        starts++;
        emit('a');
        emit('b');
        return { text: 'ab' };
      },
      { hedgeAfterMs: 50, onDelta: (d) => out.push(d) },
    );
    expect(r.text).toBe('ab');
    expect(out).toEqual(['a', 'b']);
    expect(starts).toBe(1);
  });

  it('starts a second attempt after the hedge delay and the first token wins', async () => {
    let starts = 0;
    const aborted: number[] = [];
    const out: string[] = [];
    const r = await hedged(
      async (signal, emit) => {
        const idx = starts++;
        signal.addEventListener('abort', () => aborted.push(idx));
        await sleep(idx === 0 ? 1000 : 10, signal); // first one stalls
        emit(`t${idx}`);
        return { text: `t${idx}` };
      },
      { hedgeAfterMs: 40, onDelta: (d) => out.push(d) },
    );
    expect(r.text).toBe('t1');
    expect(out).toEqual(['t1']);
    expect(aborted).toEqual([0]);
  });

  it('retries a failure before any token, honouring retryDelayMs', async () => {
    let starts = 0;
    const r = await hedged(
      async (_s, emit) => {
        if (starts++ === 0) throw Object.assign(new Error('429: slow down'), { status: 429 });
        emit('ok');
        return { text: 'ok' };
      },
      {
        hedgeAfterMs: 0,
        onDelta: () => undefined,
        retryDelayMs: (e) => ((e as { status?: number }).status === 429 ? 5 : null),
      },
    );
    expect(r.text).toBe('ok');
    expect(starts).toBe(2);
  });

  it('gives up immediately when retryDelayMs returns null', async () => {
    let starts = 0;
    await expect(
      hedged(
        async () => {
          starts++;
          throw new Error('401: bad key');
        },
        { hedgeAfterMs: 0, onDelta: () => undefined, retryDelayMs: () => null },
      ),
    ).rejects.toThrow('401');
    expect(starts).toBe(1);
  });

  it('treats an empty result as a failed attempt and retries', async () => {
    let starts = 0;
    const r = await hedged(
      async (_s, emit) => {
        if (starts++ === 0) return { text: '' };
        emit('x');
        return { text: 'x' };
      },
      { hedgeAfterMs: 0, onDelta: () => undefined, isEmpty: (x) => !x.text },
    );
    expect(r.text).toBe('x');
    expect(starts).toBe(2);
  });

  it('rejects when the caller aborts and stops all attempts', async () => {
    const ac = new AbortController();
    const aborted: number[] = [];
    let starts = 0;
    const p = hedged(
      async (signal) => {
        const idx = starts++;
        signal.addEventListener('abort', () => aborted.push(idx));
        await sleep(5000, signal);
        return { text: 'late' };
      },
      { hedgeAfterMs: 20, signal: ac.signal, onDelta: () => undefined },
    );
    setTimeout(() => ac.abort(new Error('restart')), 60);
    await expect(p).rejects.toThrow('restart');
    expect(aborted.sort()).toEqual([0, 1]);
  });
});
