import { appendFileSync, existsSync, mkdirSync, statSync, renameSync } from 'node:fs';
import { join } from 'node:path';

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Patterns that must never reach a log file. */
const SECRET_PATTERNS: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{8,}/g,
  /\b[a-f0-9]{32,}\b/gi, // Deepgram / AssemblyAI style hex keys
  /(Authorization|Token|api[_-]?key|x-api-key)(["']?\s*[:=]\s*["']?)([^\s"',]+)/gi,
];

export function redact(input: unknown): string {
  let s: string;
  if (typeof input === 'string') s = input;
  else if (input instanceof Error) s = `${input.name}: ${input.message}`;
  else {
    try {
      s = JSON.stringify(input);
    } catch {
      s = String(input);
    }
  }
  for (const re of SECRET_PATTERNS) {
    s = s.replace(re, (m, ...groups) => {
      if (typeof groups[0] === 'string' && typeof groups[2] === 'string') {
        return `${groups[0]}${groups[1]}[redacted]`;
      }
      return m.length > 12 ? `${m.slice(0, 4)}…[redacted]` : '[redacted]';
    });
  }
  return s;
}

class Logger {
  private file: string | null = null;
  private minLevel: Level = 'info';
  private consoleLevel: Level = 'debug';

  init(logDir: string, opts?: { minLevel?: Level; consoleLevel?: Level }): void {
    if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
    this.file = join(logDir, 'kestrel.log');
    if (opts?.minLevel) this.minLevel = opts.minLevel;
    if (opts?.consoleLevel) this.consoleLevel = opts.consoleLevel;
    this.rotate();
  }

  private rotate(): void {
    if (!this.file || !existsSync(this.file)) return;
    try {
      const size = statSync(this.file).size;
      if (size > 5 * 1024 * 1024) renameSync(this.file, this.file + '.1');
    } catch {
      /* ignore */
    }
  }

  private write(level: Level, scope: string, args: unknown[]): void {
    const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${args
      .map((a) => redact(a))
      .join(' ')}`;
    if (LEVEL_ORDER[level] >= LEVEL_ORDER[this.consoleLevel]) {
      const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
      fn(line);
    }
    if (this.file && LEVEL_ORDER[level] >= LEVEL_ORDER[this.minLevel]) {
      try {
        appendFileSync(this.file, line + '\n');
      } catch {
        /* ignore */
      }
    }
  }

  scope(scope: string) {
    return {
      debug: (...a: unknown[]) => this.write('debug', scope, a),
      info: (...a: unknown[]) => this.write('info', scope, a),
      warn: (...a: unknown[]) => this.write('warn', scope, a),
      error: (...a: unknown[]) => this.write('error', scope, a),
    };
  }

  get logFile(): string | null {
    return this.file;
  }
}

export const logger = new Logger();
export type ScopedLogger = ReturnType<Logger['scope']>;
