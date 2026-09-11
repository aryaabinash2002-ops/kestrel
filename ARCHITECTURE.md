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

## Live answers (M5)

* `LLMService` wraps one `@anthropic-ai/sdk` client (created once; the SDK's fetch transport keeps the connection alive). Everything streams; requests carry an `AbortSignal`. On the live path (`fast: true`) thinking is disabled and effort is `low` on models that support it (Haiku 4.5 takes neither parameter). `json()` uses structured outputs (`output_config.format`) with a free-form JSON fallback.
* `ContextBuilder` renders the static prefix (system prompt template + résumé + JD + story bank + notes) as one system block and attaches `cache_control: ephemeral` only when the estimated prefix length reaches the model's minimum cacheable size (Haiku 4.5: 4096 tokens, Sonnet 5: 1024, Opus 5: 512). The per-request user message is `<earlier_summary>` (running 150-word summary, refreshed every 5 min) + `<transcript_recent>` (last 5 minutes, ≤ 7000 chars, ME/THEM labelled) + `Question: …`.
* `AnswerEngine` runs one stream at a time. It parses the strict `HEADLINE:` / `POINTS:` format incrementally (`parseAnswer.ts`), emits `answer:event` deltas throttled to ~30/s, fires `headline` the moment the headline line completes, records `question_end_ts / request_start_ts / first_token_ts / headline_done_ts` per answer into `latency_samples`, and applies the concurrency rules: same question in flight → ignore; < 70 % streamed → cancel and restart; ≥ 70 % → queue; different auto answers ≥ 2 s apart; manual *Answer now* always overrides. `warm()` sends a `max_tokens: 1` request at session start (which also writes the prompt cache when the prefix qualifies).
* Latency is shown per card (Settings → Look → *Show latency on cards*) and charted in Settings → Diag.
* `scripts/dev/fake-anthropic.mjs` is a scriptable Messages-API stand-in (SSE streaming, cache accounting, 401s) used by `tests/answerEngine.test.ts` and for offline smoke runs.

## Instant auto-answering (M6)

* `detection/QuestionDetector.ts` — the §5.3 heuristic (`looksLikeQuestion`, a single precompiled regex, ≈ µs per call) plus the §5.2 state machine fed by THEM interim/final events: a stable interim (no new words for 350 ms) that looks like a question emits `question {speculative: true}`; every later stable text or the final emits `update` with the word overlap against the text already answered — `restart: true` below 80 %, otherwise the running answer is kept (only its `questionEndTs` is corrected). Non-question finals emit `statement`.
* `llm/AutoAnswer.ts` glues it together: `question` → `AnswerEngine.requestAuto` (+ `question:detected` for the UI) and, in parallel, `Classifier.classify` (JSON `{is_question, question, type}` via the fast model). The classifier never gates the answer: `is_question=false` → the card is discarded (fades out), `smalltalk` with smalltalk answers off → card discarded and a clickable chip shown, otherwise the card is labelled with the type. `update.restart` → `requestAuto({restartOf: cardId})` swaps the card in place (the shown headline stays until replaced).
* Concurrency rules live in `AnswerEngine.requestAuto` (M5 section). Diagnostics report speculative share and restart rate (`restarts / speculativeStarts`, target < 20 %).
* `tests/e2e.instantAnswer.test.ts` streams `tests/fixtures/question.wav` (16 kHz PCM) through the real `TranscriptionService` + `DeepgramTranscriber` (against the fake Deepgram) into `AutoAnswer` + `AnswerEngine` (against the fake Anthropic) and asserts: the answer starts before the final transcript exists, a matching final does not restart it, a materially longer final does, statements never answer, smalltalk becomes a chip.

## Profiles & session setup (M7)

* `docs/parseResume.ts` extracts text from PDF (`pdf-parse` v2 `PDFParse.getText`), DOCX (`mammoth.extractRawText`), TXT/MD, then normalises whitespace and unwraps mid-sentence line breaks; capped at 60 k chars. Files chosen through the native dialog are copied to `data/files/documents/`; drag-and-drop from the renderer arrives as base64.
* Setup screen: profile cards → `ProfileForm` (role/company/type/language/length/tone, résumé + JD paste-or-import, story bank of up to 12 STAR stories, notes). Deep links: `#/setup?new=1`, `#/setup?test=1`.
* `StartSessionDialog` is the only way a new live session starts from the UI: profile picker + the §11 per-session consent checkbox, then `session:start` → `audio:start`. `settings.lastProfileId` remembers the profile for auto-started (Meet) sessions.
* `TestWithMeet` runs a throw-away session, shows the THEM level, transcription socket status and the latest THEM text, and deletes the session on close.

## Screenshot solve (M8)

* `screenshot/ScreenshotService.ts`: hides the Kestrel panel for ~120 ms, captures the display under the cursor with `desktopCapturer.getSources` at native resolution, then (region mode) opens a transparent always-on-top overlay window per display (`src/renderer/region/`, preload `region.ts`) showing the frozen frame: drag = region, click/Enter = whole screen, Esc = cancel. The crop is saved to `data/files/screenshots/<id>.png`, inserted into `screenshots`, downscaled to ≤ 1600 px for the model, and sent as a base64 image block to the strong model (`models.heavy`, adaptive thinking, effort medium) with the `screenshot_solve` template (problem → approach → pseudocode → complexity → edge cases → code in the preferred language). The last 90 s of THEM speech is attached as context. Output streams via `screenshot:event` and renders with the dependency-free `Markdown` component (code blocks get a copy button).
* Hotkey `screenshotSolve` (default ⌘⇧S) opens region selection; the Live screen's *Solve screen* button does the same.

## Follow-up chat (M9) and polish (M12)

* `AnswerEngine.chat(text)` cancels any in-flight answer and streams a free-form reply (≤ 80 words, first line = the useful sentence) built from the same cached system prefix, the recent transcript, the last three suggested answers and the user's request. The `ChatBox` sits under the transcript on the Live screen with quick chips (Shorter / With numbers / Ask them back / Simplify); smalltalk chips also route here.
* Error states: transcription socket status banner (connecting / reconnecting with attempt count / error), `AudioHints` (extension paired-but-not-capturing, extension missing, no signal from the other party with the device to select, Bluetooth call-mode headset), key problems as sticky toasts plus an error card, an *Offline* badge in the header driven by the renderer's online/offline events, and uncaught main-process errors logged (never crash the panel).
* See-through panel: the panel `BrowserWindow` is always created `transparent` (`backgroundColor: '#00000000'`); `settings.ui.glass` adds the `glass` class on `<html>`, which swaps the theme tokens for translucent ones (`--background` alpha = `--panel-alpha` from `glassAlpha`, cards ≈ 72 %, popovers ≈ 94 %) while text stays opaque, and the main process adds native blur behind it (`setVibrancy('hud')` on macOS, `setBackgroundMaterial('acrylic')` on Windows 11). Toggling never recreates the window.
* Themes (dark / light / system) are CSS-variable palettes on `:root` / `.dark`; opacity, always-on-top, compact layout (narrower window, denser cards, transcript collapsed by default) and font size are applied live from settings. Global hotkeys: start/stop listening (opens the start dialog when no session exists), answer now, screenshot solve, toggle panel, clear cards.

## Post-session review (M10)

* `review/ReviewService.ts` builds a `ReviewDocument` (session, profile, final utterances, answers, screenshots, stored summary) from SQLite. `generate()` renders `prompts/review.md` with the profile (user name, role, company, type, language) and sends the merged, time-ordered transcript — `[mm:ss] ME/THEM: …` lines plus `AI (suggested for "…")` lines for every completed answer — to the strong model through `LLMService.json()` with a strict five-field schema (`summary`, `questions[]`, `weakSpots[]`, `followUpEmail`, `actionItems[]`). The result is normalised, stamped with `generatedAt`, stored in `sessions.summary_json`, and returned; empty transcripts fail fast with a clear message.
* `export(id, 'md'|'pdf')` writes `data/exports/kestrel-review-<YYYY-MM-DD-HHmm>[-<profile slug>].md|pdf`. The Markdown covers title/date/duration, the five review sections (or a "no review generated" note), every suggested answer (headline + points), screenshots with their results, and the full timestamped transcript. PDF reuses the same Markdown through a tiny Markdown→HTML converter, loads it as a `data:` URL in a hidden sandboxed `BrowserWindow` and calls `printToPDF` (A4, backgrounds on).
* Renderer: `store/review.ts` + `components/review/{SessionList,SessionDetail}.tsx` behind the `/review` and `/review/:sessionId` routes (the latter is where the Meet extension sends the user when a call ends). Opening a finished session without a review auto-generates one once per app run when an Anthropic key is stored; sessions can be deleted in one click (with confirmation) and exports open the destination folder.

## Practice mode (M11)

* `practice/questionBank.ts` holds the static sets (common behavioral, verbal coding, system design, seeded shuffle); the `role` set is generated by the strong model from the profile's JD + résumé via the `practice_interviewer` template and a `{questions: string[]}` JSON schema, falling back to the behavioral bank when there is no JD or the model returns nothing.
* `practice/PracticeService.ts` runs a session with `mode: 'practice'` (so `AutoAnswer` stays off) and `audio.start({ them: false })` — microphone only, so the TTS interviewer is never captured as THEM. It pushes `practice:event`s: `question {index,total,question,category}` → the renderer speaks it with the Web Speech API (`components/practice/tts.ts`) and collects the answer from ME finals whose `startMs` is after the question was shown (editable before submit) → `practice:submit(text)` → `scoring` → `llm.json` with the `practice_scorer` template and `SCORE_SCHEMA` (exact mirror of `PracticeScore['score']`, values clamped to 1–10) → `db.savePracticeScore` → `score` → the next `question` is emitted immediately (the renderer parks it until *Next*) → `finished` stops audio and ends the session.
* `history(profileId)` folds `practice_scores` per practice session into `PracticeHistoryEntry` (count, average); the Practice screen shows setup, the live question/answer view (mic meter, interim text), the score card (overall + four sub-scores, strengths, "improve one thing", collapsible model answer), a results summary and per-profile progress. Deep link for smoke tests: `#/practice?start=<set>&count=N&tts=0|1[&autosubmit=1]`.

## Real-API tuning notes (2026-09-11, macOS, Deepgram Nova-3 + Claude Haiku 4.5, measured from the UAE)

Spoken questions (macOS `say`) played through the speakers, captured by loopback, transcribed by Deepgram, auto-detected and answered:

| Stage | Typical |
|---|---|
| Interim containing the last word arrives | ~300 ms after it is spoken |
| Final (`speech_final`) arrives | ~500–650 ms with `endpointing=200` (~800 ms with 300) |
| Haiku 4.5 first token after the request starts | 670–990 ms (varies with API load; ~750 ms warm) |
| First token after the question's last word (non-speculative) | 1.2–1.7 s |
| p95 | < 2.0 s (one 2.4 s outlier during a slow API response) |

Tuning that came out of these runs: (1) speculation is gated on the THEM audio actually going quiet (`AudioManager.silenceMs`) and waits longer when the interim ends mid-clause (`endsMidClause`), because Deepgram's interim cadence has gaps that look like pauses; (2) a final that adds a *content word* ("…your biggest" → "…your biggest weakness?") restarts even at ≥ 80 % overlap, otherwise the answer is for the wrong question; (3) an utterance that starts within 1.5 s of the previous final is merged into the same question (two-part questions, short pauses) so `endpointing` could be lowered to 200 ms; (4) on restart the previous headline stays on screen dimmed until the new one streams in. The ≤ 1.0 s p50 target needs the answer to start before the question ends, which happens only when the interim already contains the last content word; from a region with ~200 ms RTT to the API the floor for a post-question start is ≈ 0.5 s (final) + 0.7 s (first token).

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
