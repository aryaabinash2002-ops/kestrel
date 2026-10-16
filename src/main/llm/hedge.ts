/**
 * Tail-latency hedge for streaming requests. Runs `attempt`; if no token arrived after
 * `hedgeAfterMs`, starts a second identical attempt. The first attempt to produce a token
 * wins and the others are aborted. Failures before any token are retried (up to
 * `maxAttempts` in total) unless `retryDelayMs` returns null for that error.
 */
export interface HedgeOptions<R> {
  hedgeAfterMs: number;
  maxAttempts?: number;
  signal?: AbortSignal;
  onDelta: (delta: string) => void;
  /** ms to wait before retrying this error, or null to give up immediately. */
  retryDelayMs?: (err: unknown) => number | null;
  /** A resolved result with no tokens counts as a failed attempt. */
  isEmpty?: (result: R) => boolean;
}

export function hedged<R>(
  attempt: (signal: AbortSignal, onDelta: (delta: string) => void) => Promise<R>,
  o: HedgeOptions<R>,
): Promise<R> {
  const maxAttempts = o.maxAttempts ?? 3;
  return new Promise<R>((resolve, reject) => {
    let winner = -1;
    let attempts = 0;
    let running = 0;
    let lastErr: unknown = null;
    let settled = false;
    const controllers: AbortController[] = [];
    let hedgeTimer: ReturnType<typeof setTimeout> | null = null;

    // On success the winner has already completed, so only the losers are aborted; on
    // failure/caller abort every attempt (winner included) must be torn down.
    const finish = (fn: () => void, abortWinner: boolean) => {
      if (settled) return;
      settled = true;
      if (hedgeTimer) clearTimeout(hedgeTimer);
      controllers.forEach((c, i) => (abortWinner || i !== winner) && c.abort());
      fn();
    };
    const fail = (err: unknown) =>
      finish(() => reject(err instanceof Error ? err : new Error(String(err))), true);
    if (o.signal?.aborted) {
      fail(o.signal.reason ?? new Error('aborted'));
      return;
    }
    o.signal?.addEventListener('abort', () => fail(o.signal?.reason ?? new Error('aborted')));

    const scheduleRetry = (delay: number | null) => {
      if (settled) return;
      if (delay === null || attempts >= maxAttempts) {
        fail(lastErr);
        return;
      }
      setTimeout(launch, delay);
    };

    const launch = () => {
      if (settled || attempts >= maxAttempts) return;
      const idx = attempts++;
      running++;
      const ac = new AbortController();
      controllers.push(ac);
      attempt(ac.signal, (d) => {
        if (settled) return;
        if (winner === -1) {
          winner = idx;
          if (hedgeTimer) clearTimeout(hedgeTimer);
          controllers.forEach((c, i) => i !== idx && c.abort());
        }
        if (winner === idx) o.onDelta(d);
      }).then(
        (res) => {
          if (settled) return;
          const empty = o.isEmpty?.(res) ?? false;
          if (winner === idx || (winner === -1 && !empty)) finish(() => resolve(res), false);
          else if (winner === -1) {
            running--;
            lastErr = new Error('empty response');
            if (running === 0) scheduleRetry(0);
          }
        },
        (err) => {
          if (settled || winner === idx) return;
          running--;
          if (winner !== -1) return; // a loser being aborted
          lastErr = err;
          if (running === 0) scheduleRetry(o.retryDelayMs ? o.retryDelayMs(err) : 0);
        },
      );
      if (idx === 0 && o.hedgeAfterMs > 0)
        hedgeTimer = setTimeout(() => winner === -1 && launch(), o.hedgeAfterMs);
    };
    launch();
  });
}
