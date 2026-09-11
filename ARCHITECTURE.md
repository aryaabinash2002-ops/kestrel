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
