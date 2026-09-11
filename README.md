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

Useful scripts: `npm run typecheck`, `npm run lint`, `npm test`, `npm run package:mac`, `npm run package:win`, `npm run build:ext`.

## Milestone status

| # | Milestone | Status |
|---|-----------|--------|
| 1 | Skeleton: Electron + React + TS + Tailwind, typed IPC, keychain settings, SQLite | ✅ |
| 2 | Audio capture (mic + system audio), device pickers, level meters | ✅ macOS verified; Windows untested |
| 3 | Streaming transcription (Deepgram / AssemblyAI), live transcript, echo filter | ✅ (fake-server tests; real-key run pending) |
| 4 | Google Meet Chrome extension | ⏳ |
| 5 | LLM answers, prompt caching, warm connection, latency logging | ⏳ |
| 6 | Instant auto-answering (speculative, parallel classifier) | ⏳ |
| 7 | Profiles: résumé/JD upload, story bank, "Test with Meet" | ⏳ |
| 8 | Screenshot solve | ⏳ |
| 9 | Follow-up chat box | ⏳ |
| 10 | Post-session review + export | ⏳ |
| 11 | Practice mode | ⏳ |
| 12 | Polish | ⏳ |
| 13 | Packaging | ⏳ |

See `ARCHITECTURE.md` for how the pieces fit together.
