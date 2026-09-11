// Typed wrapper around the plain-JS fake so tests get types.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - plain ESM module without types
import {
  startFakeAnthropic as start,
  defaultResponder as responder,
} from '../../scripts/dev/fake-anthropic.mjs';

export interface FakeRequest {
  body: {
    model: string;
    system?: { type: string; text: string; cache_control?: { type: string } }[] | string;
    messages: { role: string; content: unknown }[];
    max_tokens: number;
    stream?: boolean;
    output_config?: unknown;
    thinking?: unknown;
  };
  at: number;
  aborted: boolean;
}
export interface FakeAnthropic {
  url: string;
  requests: FakeRequest[];
  close: () => Promise<void>;
}
export interface FakeOptions {
  responder?: (body: FakeRequest['body']) => string;
  tokenDelayMs?: number;
  firstTokenDelayMs?: number;
  port?: number;
}
export const startFakeAnthropic = start as (opts?: FakeOptions) => Promise<FakeAnthropic>;
export const defaultResponder = responder as (body: FakeRequest['body']) => string;
