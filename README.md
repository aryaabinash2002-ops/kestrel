# Kestrel — real-time AI interview & call copilot

Kestrel listens to a live call (Zoom, Google Meet, Teams, Webex or anything playing audio), transcribes both sides in real time, detects questions as they are asked and streams a concise, personalised answer into a floating side panel — usually within a second, often before the other person has finished the sentence. Answers are grounded in your résumé, the job description, your story bank and your notes. A Practice Mode (AI mock interviewer with scoring) and a Post-Session Review (transcript, summary, weak spots, follow-up email) make it useful before, during and after a call.

Kestrel is a normal window: it shows up in screen shares and recordings like any other app, and it never types into other applications. It shows a red **● Listening** indicator whenever audio is captured, and asks for a per-session confirmation that participants are aware or the use is permitted.

## Requirements

* macOS 13+ (system-audio capture without extra software needs macOS 14.2+) or Windows 10/11
* Node 20+ and npm to build from source (developed on Node 26 / npm 11)
* Bring-your-own API keys: **Anthropic** (answers, review, scoring) and **Deepgram** or **AssemblyAI** (streaming transcription). Keys are stored in the OS keychain.

## Quick start

```bash
npm install            # installs deps and rebuilds native modules for Electron
npm run build:ext      # bundles the Google Meet extension into extension/dist
npm run dev            # hot-reloading dev build
# or
npm run build && npm run preview
```

1. First run: accept the consent notice, paste your API keys, grant the microphone and (macOS) System Audio Recording permissions.
2. **Setup → New**: create a profile (role, company, type, résumé PDF/DOCX, job description, 5–10 STAR stories, notes).
3. **Setup → Test with Meet** to confirm the other party's audio is captured and transcribed.
4. On a call: **Live → Start listening** (or `⌘⇧L` / `Ctrl+Shift+L`). Questions are answered automatically; `⌘⇧A` answers the last 30 seconds on demand; `⌘⇧S` solves what is on screen; the chat box at the bottom takes follow-ups like "shorter" or "what should I ask them back?".
5. After the call, **Review** generates a summary, the questions asked, weak spots, a follow-up email and action items, and exports Markdown/PDF.

### macOS permissions

* **Microphone** — prompted on first use (Settings → Privacy & Security → Microphone).
* **System Audio Recording** — macOS 14.2+ captures other apps' audio through a CoreAudio tap, gated by Privacy & Security → *Screen & System Audio Recording* → **System Audio Recording Only**. Enable it for Kestrel (or, when running unpackaged with `npm run dev`, for your terminal/IDE, which is the "responsible process"), then restart. If levels stay at zero, install [BlackHole](https://existential.audio/blackhole/) and choose it as a *Virtual audio device* in Settings → Audio, or use the Meet extension.
* **Screen Recording** — only needed for *Solve what's on screen*.

### Windows

System audio loopback works natively (Settings → Audio → *System audio*). Make sure the call app plays through the default output device.

## Google Meet extension

The extension captures only the Meet tab's audio (no notifications or music) and forwards Meet's built-in captions as a backup transcript with speaker names.

1. `npm run build:ext` → `extension/dist` (also `extension/kestrel-extension.zip`).
2. In Chrome/Edge/Brave/Arc open `chrome://extensions`, enable **Developer mode**, **Load unpacked**, pick `extension/dist`.
3. In Kestrel → Settings → Audio → *Google Meet extension*, copy the pairing token. Open the extension popup → Pairing → paste token → **Save & test**.
4. Join a Meet call and click the Kestrel icon once on that tab (or press `Alt+Shift+K`). Chrome only allows tab capture after the extension was invoked on the tab. With *auto-start* on, Kestrel starts a session when you join and opens the review when you leave.
5. Turn on Meet captions (CC) to get speaker names and a fallback transcript if the transcription provider is down.

Without the extension (any browser, Zoom, Teams…), Kestrel captures system audio; in the call app's audio settings the **Speaker** must be the device Kestrel captures (shown in Settings → Audio).

## Packaging

```bash
npm run package:mac    # DMG for arm64 + x64 in release/
npm run package:win    # NSIS installer (run on Windows or with the electron-builder Windows toolchain)
npm run package:dir    # unpacked app for a quick check
```

The extension bundle is copied into the app's resources; *Settings → Audio → Extension folder* opens it for "Load unpacked". Builds are unsigned unless you configure a signing identity / certificate for electron-builder.

## Developer switches and tools

* `KESTREL_SMOKE=/path.png` renders the panel and captures it, printing `SMOKE_RESULT` with renderer console errors. Modifiers: `KESTREL_SMOKE_ROUTE="#/settings/keys"`, `KESTREL_SMOKE_SESSION=1` (start a live session + audio), `KESTREL_SMOKE_ANSWER=1`, `KESTREL_SMOKE_CHAT=1`, `KESTREL_SMOKE_SCREENSHOT=1`, `KESTREL_SMOKE_SEED_PROFILE=1`, `KESTREL_SMOKE_SETTINGS='{"ui":{"theme":"light"}}'`, `KESTREL_SMOKE_AUDIO=1` (level probe).
* `KESTREL_USER_DATA=/tmp/x` runs an isolated instance (own settings/DB); `KESTREL_STT_ENDPOINT=ws://…` points transcription at a fake server; `KESTREL_ANTHROPIC_BASE_URL=http://127.0.0.1:47800` + `node scripts/dev/fake-anthropic.mjs 47800` gives an offline LLM; `KESTREL_DEV_ANTHROPIC_ENV=1` lets the SDK read `ANTHROPIC_API_KEY` from the environment when no key is stored (dev only).
* `node scripts/dev/fake-extension.mjs --leave-after 12000` simulates the Meet extension (join, audio, captions, leave) against a running app.
* Scripts: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build:ext`, `npm run build:icons`.

## Tests

`npm test` runs the unit and end-to-end suites: question-detector heuristics and timing, context-builder trimming/caching rules, prompt rendering, answer parsing, echo filter, Deepgram client (against a fake server: query params, reconnect + replay, keep-alive, auth errors), transcription utterance building, extension bridge protocol, document parsing (PDF/DOCX/TXT fixtures), the answer engine's concurrency rules (against a fake Anthropic server), and one end-to-end run that streams `tests/fixtures/question.wav` through the whole pipeline and asserts the answer starts before the final transcript.

## Milestone status

| # | Milestone | Status |
|---|-----------|--------|
| 1 | Skeleton: Electron + React + TS + Tailwind, typed IPC, keychain settings, SQLite | ✅ |
| 2 | Audio capture (mic + system audio), device pickers, level meters | ✅ macOS verified; Windows untested |
| 3 | Streaming transcription (Deepgram / AssemblyAI), live transcript, echo filter | ✅ (fake-server tests; real-key run pending) |
| 4 | Google Meet Chrome extension | ✅ (bridge E2E with simulated extension; real Meet call pending) |
| 5 | LLM answers, prompt caching, warm connection, latency logging | ✅ (verified against a fake Anthropic server; real-key run pending) |
| 6 | Instant auto-answering (speculative, parallel classifier) | ✅ (E2E with audio fixture + fake servers; tuning on a real Meet call pending) |
| 7 | Profiles: résumé/JD upload and parsing, story bank, "Test with Meet" | ✅ |
| 8 | Screenshot solve | ✅ (full-screen path smoke-tested; region overlay needs a manual drag) |
| 9 | Follow-up chat box | ✅ |
| 10 | Post-session review + export | ⏳ |
| 11 | Practice mode | ⏳ |
| 12 | Polish | ⏳ |
| 13 | Packaging | ⏳ |

See `ARCHITECTURE.md` for how the pieces fit together.
