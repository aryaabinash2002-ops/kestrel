/**
 * Service worker: coordinates tab capture. The offscreen document owns the audio graph
 * and the WebSocket to the desktop app (so this worker may sleep while capture runs).
 */
import type { ExtMessage, ExtStatus } from './protocol';
import { loadSettings } from './protocol';

const OFFSCREEN_URL = 'offscreen.html';

const status: ExtStatus = {
  connection: 'disconnected',
  capturing: false,
  tabId: null,
  inCall: false,
  captionsSeen: false,
  sessionActive: false,
  lastError: null,
  appVersion: null,
};

async function ensureOffscreen(): Promise<void> {
  const has = await chrome.offscreen.hasDocument?.();
  if (has) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: [chrome.offscreen.Reason.USER_MEDIA],
    justification: 'Capture Google Meet tab audio and stream it to the Kestrel desktop app',
  });
}

async function closeOffscreen(): Promise<void> {
  try {
    if (await chrome.offscreen.hasDocument?.()) await chrome.offscreen.closeDocument();
  } catch {
    /* ignore */
  }
}

function send(msg: ExtMessage): Promise<unknown> {
  return chrome.runtime.sendMessage(msg).catch(() => undefined);
}

async function meetTab(preferred?: number): Promise<chrome.tabs.Tab | null> {
  if (preferred !== undefined) {
    const t = await chrome.tabs.get(preferred).catch(() => null);
    if (t?.url?.startsWith('https://meet.google.com/')) return t;
  }
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active?.url?.startsWith('https://meet.google.com/')) return active;
  const tabs = await chrome.tabs.query({ url: 'https://meet.google.com/*' });
  return tabs.find((t) => t.audible) ?? tabs[0] ?? null;
}

async function startCapture(preferredTab?: number): Promise<void> {
  const settings = await loadSettings();
  if (!settings.token) {
    status.lastError = 'Paste the pairing token from Kestrel → Settings → Audio first.';
    return;
  }
  const tab = await meetTab(preferredTab);
  if (!tab?.id) {
    status.lastError = 'Open a Google Meet tab first.';
    return;
  }
  try {
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
    await ensureOffscreen();
    status.tabId = tab.id;
    status.lastError = null;
    await send({
      type: 'offscreen-start',
      streamId,
      token: settings.token,
      port: settings.port,
      tabId: tab.id,
    });
    await chrome.action.setBadgeText({ text: 'ON' });
    await chrome.action.setBadgeBackgroundColor({ color: '#22c55e' });
  } catch (err) {
    status.lastError = (err as Error).message ?? String(err);
    status.capturing = false;
  }
}

async function stopCapture(): Promise<void> {
  await send({ type: 'offscreen-stop' });
  status.capturing = false;
  status.tabId = null;
  await chrome.action.setBadgeText({ text: '' });
  setTimeout(() => void closeOffscreen(), 500);
}

async function testConnection(): Promise<void> {
  const settings = await loadSettings();
  await ensureOffscreen();
  await send({ type: 'offscreen-connect', token: settings.token, port: settings.port });
}

chrome.runtime.onMessage.addListener((msg: ExtMessage, sender, reply) => {
  switch (msg.type) {
    case 'get-status':
      reply(status);
      return false;
    case 'start-capture':
      void startCapture(msg.tabId ?? sender.tab?.id).then(() => reply(status));
      return true;
    case 'stop-capture':
      void stopCapture().then(() => reply(status));
      return true;
    case 'test-connection':
      void testConnection().then(() => reply(status));
      return true;
    case 'offscreen-status':
      Object.assign(status, msg.status);
      if (status.connection !== 'connected' && !status.capturing)
        void chrome.action.setBadgeText({ text: '' });
      return false;
    case 'app-message':
      if (msg.message.type === 'session') {
        status.sessionActive = msg.message.active;
        // When Kestrel starts a session while we are on a call, start capture (needs a prior user gesture on the tab).
        if (msg.message.active && status.inCall && !status.capturing)
          void startCapture(status.tabId ?? undefined);
      } else if (msg.message.type === 'request-capture') {
        if (msg.message.start) void startCapture(status.tabId ?? undefined);
        else void stopCapture();
      }
      return false;
    case 'meet-call': {
      status.inCall = msg.state === 'joined';
      if (sender.tab?.id) status.tabId = status.inCall ? sender.tab.id : status.tabId;
      void send({
        type: 'offscreen-forward',
        payload: { type: 'call', state: msg.state, url: msg.url },
      });
      if (msg.state === 'left' && status.capturing) void stopCapture();
      if (msg.state === 'joined') {
        void loadSettings().then((s) => {
          if (s.autoCapture && !status.capturing) void startCapture(sender.tab?.id);
        });
      }
      return false;
    }
    case 'meet-caption':
      status.captionsSeen = true;
      void send({
        type: 'offscreen-forward',
        payload: {
          type: 'caption',
          speaker: msg.speaker,
          text: msg.text,
          ts: msg.ts,
          isFinal: msg.isFinal,
        },
      });
      return false;
    default:
      return false;
  }
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== 'toggle-capture') return;
  if (status.capturing) void stopCapture();
  else void startCapture();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (status.tabId === tabId && status.capturing) void stopCapture();
});

chrome.runtime.onInstalled.addListener(() => {
  void chrome.action.setBadgeText({ text: '' });
});
