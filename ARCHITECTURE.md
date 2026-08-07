# ECHO architecture

Radically simplified: one UI, one Worker, one database, two explicit TTS providers, no STT.

## Stack

```
┌─────────────────────────────────────────────────────────────┐
│  Single web UI        ui/  →  Vite build  →  ui/dist        │
└───────────────────────────┬─────────────────────────────────┘
                            │ [assets] binding
┌───────────────────────────▼─────────────────────────────────┐
│  Cloudflare Worker    worker/src/index.ts                   │
│    /api/health        status                                │
│    /api/voices        catalog with explicit provider        │
│    /api/sample-text   static sample                         │
│    /api/tts           Workers AI OR clone sidecar           │
│    /api/parse         .txt/.md/.docx/.pdf                   │
│    /api/drafts        D1 drafts only                        │
└───────────────────────────┬─────────────────────────────────┘
                            │ ECHO_CLONE_TTS_URL (for clone voices)
┌───────────────────────────▼─────────────────────────────────┐
│  Local clone sidecar  clone/                                │
│  SpeechT5 / OpenVoice for echo, patricia, martin-en, martin-fr
└─────────────────────────────────────────────────────────────┘
```

## Principles

- **One responsibility per module.** TTS routing, file parsing, storage, and auth each have one owner.
- **No silent fallbacks.** A voice has one provider. If that provider fails, the UI shows the failure.
- **No duplicated state.** Drafts live in D1; local persistence is limited to the current in-flight text/voice/speed.
- **No manual cache busting.** Vite content-hashes static assets; `index.html` is revalidated.

## Modules

| Module | Inputs | Outputs |
|--------|--------|---------|
| `ui/src/api.ts` | endpoint + payload | JSON or binary |
| `ui/src/audio.ts` | base64 audio + word timings | `<audio>` + highlight index |
| `ui/src/text.ts` | raw text | word count, duration estimate |
| `worker/src/tts.ts` | `{text, voice_id, speed}` | audio bytes + metadata |
| `worker/src/parse.ts` | file bytes + filename | extracted text |
| `worker/src/storage.ts` | D1 + draft payload | drafts CRUD |
| `worker/src/auth.ts` | request + `ECHO_API_KEY` | 401 or pass |

## Clone sidecar

The local sidecar (`clone/`) serves the four clone voices. It previously
loaded SpeechT5, the speaker encoder, OpenVoice/MeloTTS and voice
embeddings lazily on the first request, causing a ~55 s cold start after a
restart. It now pre-loads and warms up both pipelines during application
startup, so the first request is fast.

Startup cost is paid once at boot; the systemd unit allows 300 s for it.

## Deploy

One command for the edge: `npm run build && npm run deploy`.
The clone sidecar is restarted separately via `clone/systemd/` units.
