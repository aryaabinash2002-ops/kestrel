# Kestrel — real-time AI interview & call copilot

Kestrel listens to a live call (Zoom, Google Meet, Teams, Webex or anything playing audio), transcribes both sides in real time, detects questions and streams a concise, personalised answer into a floating side panel within a second or two. Answers are grounded in your résumé, the job description and your notes. It also has a Practice Mode (AI mock interviewer with scoring) and a Post-Session Review.

Kestrel is a normal window — it shows up in screen shares like any other app — and it never types into other applications. See the consent notice on first run.

## Requirements

* Node 20+ (developed on Node 26), npm
* macOS 13+ (system-audio capture needs macOS 14.2+ or a virtual audio device) or Windows 10/11
* API keys: Anthropic (answers) and Deepgram or AssemblyAI (transcription). Keys are stored in the OS keychain.

## Run

```bash
npm install          # also rebuilds native modules for Electron
npm run dev          # hot-reloading dev build
# or
npm run build && npm run preview
```

Developer switches: `KESTREL_SMOKE=/path.png` (render + capture the panel, prints `SMOKE_RESULT`), `KESTREL_STT_ENDPOINT=ws://…` (point transcription at a fake server), `KESTREL_ANTHROPIC_BASE_URL=http://127.0.0.1:47800` + `node scripts/dev/fake-anthropic.mjs 47800` (offline LLM), `KESTREL_DEV_ANTHROPIC_ENV=1` (use `ANTHROPIC_API_KEY` from the environment when no key is stored — dev only).

Useful scripts: `npm run typecheck`, `npm run lint`, `npm test`, `npm run package:mac`, `npm run package:win`, `npm run build:ext`.

## Google Meet extension

The extension captures only the Meet tab's audio (no notifications or music) and forwards Meet's built-in captions as a backup transcript with speaker names.

1. `npm run build:ext` → `extension/dist` (also `extension/kestrel-extension.zip`).
2. In Chrome/Edge/Brave/Arc open `chrome://extensions`, enable **Developer mode**, **Load unpacked**, pick `extension/dist`.
3. In Kestrel → Settings → Audio → *Google Meet extension*, copy the pairing token. Open the extension popup → Pairing → paste token → **Save & test**.
4. Join a Meet call and click the Kestrel icon once on that tab (or press `Alt+Shift+K`). Chrome only allows tab capture after the extension was invoked on the tab. With *auto-start* on, Kestrel starts a session when you join and opens the review when you leave.
5. Turn on Meet captions (CC) to get speaker names and a fallback transcript if the transcription provider is down.

## Milestone status

| # | Milestone | Status |
|---|-----------|--------|
| 1 | Skeleton: Electron + React + TS + Tailwind, typed IPC, keychain settings, SQLite | ✅ |
| 2 | Audio capture (mic + system audio), device pickers, level meters | ✅ macOS verified; Windows untested |
| 3 | Streaming transcription (Deepgram / AssemblyAI), live transcript, echo filter | ✅ (fake-server tests; real-key run pending) |
| 4 | Google Meet Chrome extension | ✅ (bridge E2E with simulated extension; real Meet call pending) |
| 5 | LLM answers, prompt caching, warm connection, latency logging | ✅ (verified against a fake Anthropic server; real-key run pending) |
| 6 | Instant auto-answering (speculative, parallel classifier) | ✅ (E2E with audio fixture + fake servers; tuning on a real Meet call pending) |
| 7 | Profiles: résumé/JD upload, story bank, "Test with Meet" | ⏳ |
| 8 | Screenshot solve | ⏳ |
| 9 | Follow-up chat box | ⏳ |
| 10 | Post-session review + export | ⏳ |
| 11 | Practice mode | ⏳ |
| 12 | Polish | ⏳ |
| 13 | Packaging | ⏳ |

See `ARCHITECTURE.md` for how the pieces fit together.
