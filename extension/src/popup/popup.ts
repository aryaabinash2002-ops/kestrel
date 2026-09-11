import type { ExtMessage, ExtStatus } from '../protocol';
import { loadSettings, saveSettings } from '../protocol';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function ask<T = ExtStatus>(msg: ExtMessage): Promise<T> {
  return chrome.runtime.sendMessage(msg) as Promise<T>;
}

function render(s: ExtStatus): void {
  const dot = $('dot');
  dot.className =
    'dot ' +
    (s.connection === 'connected'
      ? 'on'
      : s.connection === 'connecting'
        ? 'warn'
        : s.connection === 'disconnected'
          ? ''
          : 'err');
  $('conn').textContent =
    s.connection === 'connected'
      ? `Connected to Kestrel ${s.appVersion ?? ''}`
      : s.connection === 'connecting'
        ? 'Connecting…'
        : s.connection === 'bad-token'
          ? 'Wrong pairing token'
          : s.connection === 'error'
            ? 'Connection error'
            : 'Not connected';
  $('call').textContent = s.inCall ? 'In a call' : 'Not in a call';
  $('cap').textContent = s.capturing ? 'Streaming to Kestrel' : 'Off';
  $('cap').className = s.capturing ? 'ok' : 'muted';
  $('captions').textContent = s.captionsSeen
    ? 'Reading captions'
    : 'Off (turn on captions in Meet)';
  const err = $('error');
  err.hidden = !s.lastError;
  err.textContent = s.lastError ?? '';
  const btn = $<HTMLButtonElement>('toggle');
  btn.textContent = s.capturing ? 'Stop capture' : 'Start capture';
  btn.className = s.capturing ? '' : 'primary';
}

async function refresh(): Promise<void> {
  render(await ask({ type: 'get-status' }));
}

async function init(): Promise<void> {
  const settings = await loadSettings();
  $<HTMLInputElement>('token').value = settings.token;
  $<HTMLInputElement>('port').value = String(settings.port);
  $<HTMLInputElement>('auto').checked = settings.autoCapture;
  if (!settings.token) ($('pair') as HTMLDetailsElement).open = true;
  await refresh();
  // Ask the current tab whether it is in a call so the popup is accurate even if the worker slept.
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id && tab.url?.startsWith('https://meet.google.com/')) {
    chrome.tabs
      .sendMessage(tab.id, { type: 'meet-query' } satisfies ExtMessage)
      .catch(() => undefined);
  }
  setInterval(() => void refresh(), 1500);
}

$('toggle').addEventListener('click', async () => {
  const s = await ask({ type: 'get-status' });
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!s.capturing && !tab?.url?.startsWith('https://meet.google.com/')) {
    render({
      ...s,
      lastError:
        'Switch to your Google Meet tab first, then click this icon and press Start capture.',
    });
    return;
  }
  render(
    await ask(s.capturing ? { type: 'stop-capture' } : { type: 'start-capture', tabId: tab?.id }),
  );
});

$('save').addEventListener('click', async () => {
  await saveSettings({
    token: $<HTMLInputElement>('token').value.trim(),
    port: Number($<HTMLInputElement>('port').value) || 47600,
    autoCapture: $<HTMLInputElement>('auto').checked,
  });
  $('test').textContent = 'Testing…';
  await ask({ type: 'test-connection' });
  setTimeout(async () => {
    const s = await ask({ type: 'get-status' });
    $('test').textContent =
      s.connection === 'connected'
        ? '✓ Connected'
        : s.connection === 'bad-token'
          ? '✗ Wrong token'
          : s.lastError
            ? '✗ ' + s.lastError
            : '✗ Kestrel not reachable — is the app running? (reload the extension after updating it)';
    render(s);
  }, 2500);
});

void init();
