# Kestrel — Architecture

Kestrel is an Electron + React desktop app (Windows/macOS) plus a Chrome MV3 companion extension for Google Meet. It listens to a live call, transcribes both sides, detects questions and streams résumé-grounded answers into a floating panel.

This document is kept current as milestones land. Status per milestone is in `README.md`.

## Processes

```
┌─────────────── Renderer: panel (React, src/renderer/src) ───────────────┐
│ Onboarding · Setup · Live · Practice · Review · Settings                 │
└──────────────▲──────────────────────────────┬───────────────────────────┘
               │ typed IPC (window.kestrel)    │
┌──────────────┴──────────────────────────────▼───────────────────────────┐
│ Main process (src/main)                                                  │
│  SettingsStore (settings.json)  SecretStore (keytar → safeStorage)       │
│  SessionDB (better-sqlite3, WAL)  WindowManager  HotkeyManager           │
│  SessionManager (active session + rolling transcript)                    │
│  [M2] AudioManager ⇄ hidden capture renderer (Web Audio → PCM16 16 kHz)  │
│  [M3] TranscriptionService ×2 (Deepgram / AssemblyAI)  EchoFilter        │
│  [M4] ExtensionBridge (local WebSocket, pairing token)                   │
│  [M5/6] LLMService (Anthropic streaming) ContextBuilder QuestionDetector │
│  [M8] ScreenshotService   [M10] ReviewService   [M11] PracticeService     │
└──────────────────────────────────────────────────────────────────────────┘
┌─── Renderer: capture (hidden window, src/renderer/capture) ───┐
│ getUserMedia (mic) · getDisplayMedia loopback · AudioWorklet   │
└───────────────────────────────────────────────────────────────┘
```

* **Main owns every secret and every network connection.** Renderers never see API keys.
* **Typed IPC.** `src/shared/types/ipc.ts` declares three maps: `IpcInvokeMap` (renderer → main request/response), `IpcEventMap` (main → renderer push) and `IpcSendMap` (renderer → main fire-and-forget, used for PCM chunks). `src/main/ipc.ts` and `src/preload/index.ts` wrap `ipcMain`/`ipcRenderer` so a channel can only be used with its declared argument and result types.
* **Hidden capture renderer.** Web Audio APIs only exist in renderers, so audio capture runs in a hidden `BrowserWindow` (`backgroundThrottling: false`). Main talks to it with a small request/reply protocol (`CaptureRequest`/`CaptureReply`) and receives PCM via `capture:pcm`.
  * Chromium never services `getUserMedia`/`getDisplayMedia` for a document that has not been shown, so the capture window is 1×1, transparent, non-focusable and is shown *inactive* only while streams are being acquired (`AudioManager.withCaptureVisible`). Live streams keep running after it is hidden again.
  * Graph per channel: `MediaStream → AudioContext(16 kHz) → AudioWorklet('pcm-capture')` producing 80 ms PCM16 chunks plus RMS. Mic uses `echoCancellation/noiseSuppression/autoGainControl`; system audio comes from `getDisplayMedia({audio:true, video:tiny})` whose video track is dropped immediately, granted by `setDisplayMediaRequestHandler(... audio: 'loopback')` (Windows and macOS 14.2+; older macOS uses a virtual device such as BlackHole).
  * THEM source resolution (`systemAudioMode`): `auto` prefers the Meet extension when it is streaming, else loopback, else a virtual device.
* **Panel window.** A normal window with a hidden title bar, optional always-on-top (`floating` level, visible over full-screen apps), opacity, compact mode. It is deliberately *not* excluded from screen capture.

## Transcription (M3)

* `ITranscriber` (`src/main/transcription/ITranscriber.ts`) is the provider interface; `BaseTranscriber` adds status, exponential-backoff reconnect, a 3 s audio replay buffer (audio captured while reconnecting is re-sent), keep-alive when audio pauses, and provider-time → wall-clock mapping (`audioEpochMs` = time of the first chunk on a connection).
* `DeepgramTranscriber`: `wss://api.deepgram.com/v1/listen` with `model=nova-3&interim_results=true&endpointing=300&utterance_end_ms=1000&smart_format=true&punctuate=true&vad_events=true`, `Authorization: Token …`, binary PCM16 in, `Results`/`UtteranceEnd`/`SpeechStarted` out, `KeepAlive`/`Finalize`/`CloseStream` control messages.
* `AssemblyAITranscriber`: `wss://streaming.assemblyai.com/v3/ws` (Universal streaming, turn-based; formatted end-of-turn preferred, unformatted used after 400 ms).
* `TranscriptionService` opens one transcriber per channel when a session starts (sockets are opened before speech begins), builds utterances from segment finals + interim (`speech_final` / `UtteranceEnd` / 2.5 s stale timeout close them), emits `interim`/`final` events for the question detector, persists finals through `SessionManager`, and applies `EchoFilter`: ME finals are held 600 ms and dropped when >70 % similar to THEM text heard in the last 3 s.
* `KESTREL_STT_ENDPOINT=ws://…` points the app at a local/fake server. `tests/fakes/fakeDeepgram.ts` is a scriptable stand-in used by the tests.

## Google Meet extension (M4)

* `extension/` is a Manifest V3 extension bundled by `scripts/build-extension.mjs` (esbuild → `extension/dist`).
  * `background.ts` (service worker) only coordinates: `chrome.tabCapture.getMediaStreamId` for the Meet tab, creates the offscreen document, relays content-script events. It may sleep while capture runs.
  * `offscreen.ts` owns the tab `MediaStream`, an `AudioContext(16 kHz)` whose source is connected both to `destination` (so the user still hears the call) and to `worklet.js` (PCM16 80 ms chunks), and the WebSocket to the desktop app with reconnect/backoff. Chrome's MV3 CSP forbids blob: workers, so the worklet is a real file.
  * `content/meetSelectors.ts` isolates every DOM selector (candidate lists); `content/meetCaptions.ts` detects call join/leave (Leave-call button) and observes the captions region, sending interim/final caption text + speaker.
  * Tab capture needs a user gesture on the tab (popup click or the `Alt+Shift+K` command) — Chrome policy, not ours.
* `src/main/extension/ExtensionBridge.ts` is the local WebSocket server (`ws://127.0.0.1:47600`, next free port if busy; only `chrome-extension://` / localhost origins). Protocol in `src/shared/types/extension.ts`: first frame must be `hello {token}` (token `KES-XXXX-XXXX`, stored in DB `meta`), then binary PCM frames and JSON `capture` / `call` / `caption` / `ping` messages; app → extension: `welcome`, `session`, `request-capture`, `pong`, `error {bad-token|busy}`.
* `handlers/extension.ts`: extension audio → `AudioManager.ingestExternal('THEM')` (used when `systemAudioMode` is `extension` or `auto` with the extension streaming); call joined → auto-start session + listening (setting `autoStartOnMeetJoin`, reusing `lastProfileId`); call left → stop, end session, navigate to Review; captions → speaker-name hints for THEM utterances, and the full transcript source whenever the STT socket for that channel is not `open`.
* Dev tool: `node scripts/dev/fake-extension.mjs --leave-after 12000` simulates the extension against a running app.

## Storage

* `settings.json` in the Electron userData folder — no secrets, validated on write (`SettingsStore.assertNoSecrets`).
* API keys in the OS keychain via `keytar` (service `app.kestrel.copilot`). If keytar cannot load, an OS-encrypted blob (`safeStorage`) is used instead. The backend in use is shown in Settings → Keys.
* SQLite database `data/kestrel.db` (schema in `src/main/db.ts`: profiles, sessions, utterances, answers, screenshots, practice_scores, latency_samples, meta).
* Files under `data/files/{documents,screenshots}` and exports under `data/exports`. The data folder can be relocated in Settings → Data.
* Logs in `logs/kestrel.log`; every log line passes through `redact()` which scrubs anything shaped like an API key.

## Renderer

* React 19 + Vite 7 (electron-vite 5) + Tailwind v4 + shadcn-style components in `components/ui` (Radix primitives via the `radix-ui` package).
* Zustand stores (`store/*.ts`) subscribe to IPC push events once at module load; screens read from stores and call `invoke()` from `lib/ipc.ts`.
* Routing: `HashRouter` (works from `file://`). First run goes to `/onboarding` (consent → keys → permissions).

## Prompts

Built-in templates live in `src/main/prompts/*.md` and are bundled with `?raw`. Users can override any of them in Settings → Prompts; overrides are stored in `settings.prompts`. `renderTemplate()` supports `{var}` and `{if flag}…{/if}`.

## Conventions

* TypeScript strict everywhere, `noUncheckedIndexedAccess` on. ESLint + Prettier.
* Providers (transcription, LLM) sit behind interfaces so vendors can be swapped.
* Every milestone must leave the app runnable: `npm run dev` (hot reload) or `npm run build && npm run preview`.
* `KESTREL_SMOKE=/path/out.png npm run preview` renders the panel, captures it to PNG, prints renderer console errors as `SMOKE_RESULT …` and exits (used for automated checks).
