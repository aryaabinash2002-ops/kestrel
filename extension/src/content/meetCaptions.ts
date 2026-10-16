/**
 * Content script for call web clients (Meet, Zoom, Teams, Webex): detects call start/end
 * and, on Google Meet with built-in captions on, forwards caption text + speaker names.
 * Runs in every frame (all_frames): Zoom's web client renders the meeting inside an iframe.
 */
import type { ExtMessage } from '../protocol';
import { SELECTORS, query, queryAll } from './meetSelectors';

function send(msg: ExtMessage): void {
  try {
    void chrome.runtime.sendMessage(msg).catch(() => undefined);
  } catch {
    /* extension reloaded */
  }
}

// ----- call state -----
let inCall = false;
/** Fallback when no selector matches (Zoom/Teams rename classes often): a visible button labelled Leave/End. */
function leaveButtonByText(): boolean {
  for (const b of Array.from(document.querySelectorAll('button'))) {
    const t = (b.textContent ?? '').trim();
    if (
      (t === 'Leave' || t === 'End' || t === 'Leave meeting' || t === 'End meeting') &&
      b.getClientRects().length > 0
    )
      return true;
  }
  return false;
}
function checkCall(): void {
  const now = !!query(SELECTORS.leaveCallButton) || leaveButtonByText();
  if (now !== inCall) {
    inCall = now;
    send({ type: 'meet-call', state: now ? 'joined' : 'left', url: location.href });
  }
}
setInterval(checkCall, 1500);
window.addEventListener('beforeunload', () => {
  if (inCall) send({ type: 'meet-call', state: 'left', url: location.href });
});

// ----- captions -----
interface Entry {
  speaker: string;
  text: string;
  lastChange: number;
  sentFinal: boolean;
  lastSentText: string;
}
const entries = new Map<Element, Entry>();
let observer: MutationObserver | null = null;
let observedRegion: Element | null = null;
const FINAL_AFTER_MS = 1200;

function readEntries(region: Element): void {
  const blocks = queryAll(SELECTORS.captionEntry, region);
  const now = Date.now();
  for (const block of blocks) {
    const speaker = query(SELECTORS.captionSpeaker, block)?.textContent?.trim() ?? '';
    const text =
      query(SELECTORS.captionText, block)?.textContent?.trim() ?? block.textContent?.trim() ?? '';
    if (!text) continue;
    let e = entries.get(block);
    if (!e) {
      e = { speaker, text, lastChange: now, sentFinal: false, lastSentText: '' };
      entries.set(block, e);
    }
    if (e.text !== text || e.speaker !== speaker) {
      e.text = text;
      e.speaker = speaker || e.speaker;
      e.lastChange = now;
      e.sentFinal = false;
    }
    if (e.text !== e.lastSentText) {
      e.lastSentText = e.text;
      send({ type: 'meet-caption', speaker: e.speaker, text: e.text, ts: now, isFinal: false });
    }
  }
  // Entries that vanished from the DOM are final.
  for (const [el, e] of entries) {
    if (!el.isConnected) {
      if (!e.sentFinal && e.text)
        send({ type: 'meet-caption', speaker: e.speaker, text: e.text, ts: now, isFinal: true });
      entries.delete(el);
    }
  }
}

function flushStale(): void {
  const now = Date.now();
  for (const e of entries.values()) {
    if (!e.sentFinal && e.text && now - e.lastChange > FINAL_AFTER_MS) {
      e.sentFinal = true;
      send({ type: 'meet-caption', speaker: e.speaker, text: e.text, ts: now, isFinal: true });
    }
  }
}

function attachCaptions(): void {
  const region = query(SELECTORS.captionsRegion);
  if (region === observedRegion) return;
  observer?.disconnect();
  observer = null;
  observedRegion = region;
  entries.clear();
  if (!region) return;
  observer = new MutationObserver(() => {
    try {
      readEntries(region);
    } catch {
      /* selectors broke — fail silently */
    }
  });
  observer.observe(region, { childList: true, subtree: true, characterData: true });
}

setInterval(() => {
  try {
    attachCaptions();
    flushStale();
  } catch {
    /* ignore */
  }
}, 1000);

chrome.runtime.onMessage.addListener((msg: ExtMessage, _s, reply) => {
  if (msg.type === 'meet-query') {
    reply({ inCall, captions: !!observedRegion });
    return false;
  }
  return false;
});

checkCall();
