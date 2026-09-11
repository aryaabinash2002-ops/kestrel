import { describe, expect, it } from 'vitest';
import { redact } from '@main/logger';

describe('log redaction (no API key ever reaches a log line)', () => {
  it('scrubs Anthropic keys, hex keys and Authorization headers', () => {
    const line = redact(
      'key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789 and dg 0123456789abcdef0123456789abcdef and Authorization: Token 9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c and x-api-key=sk-ant-zzz',
    );
    expect(line).not.toContain('abcdefghijklmnopqrstuvwxyz0123456789');
    expect(line).not.toContain('0123456789abcdef0123456789abcdef');
    expect(line).not.toContain('9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c');
    expect(line).toContain('[redacted]');
  });

  it('keeps ordinary text and errors readable', () => {
    expect(redact('session started sess_1 live')).toBe('session started sess_1 live');
    expect(redact(new Error('connect ECONNREFUSED 127.0.0.1:47600'))).toContain('ECONNREFUSED');
  });
});
