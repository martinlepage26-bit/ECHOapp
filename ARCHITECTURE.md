# ECHO architecture

Refactored 2026-08-07. One product, four layers, one speech authority.

## Layers

```
┌─────────────────────────────────────────────────────────────┐
│  Hardline UI          web/src/*  →  martin.govern-ai.ca/echo │
│  Expo UI              frontend/  →  echo-ai.workers.dev      │
└───────────────────────────┬─────────────────────────────────┘
                            │  same-origin or /api/*
┌───────────────────────────▼─────────────────────────────────┐
│  Site proxy (thin)    web/pages-functions/echo-{tts,transcribe}.js
│  (injects ECHO_API_KEY; sample voices may short-circuit clone) │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│  Edge speech authority    workers/echo-ai/src/               │
│    worker.js  router                                        │
│    tts.js     Workers AI → SpeechT5 clone fallback          │
│    stt.js     Whisper                                       │
│    storage.js D1 drafts/transcripts                         │
│    parse.js   .txt/.md/.docx/.pdf                           │
│    auth.js    X-Echo-Key                                    │
│    http.js    CORS / JSON                                   │
└───────────────────────────┬─────────────────────────────────┘
                            │ optional ECHO_CLONE_TTS_URL
┌───────────────────────────▼─────────────────────────────────┐
│  Local clone sidecar      backend/ (SpeechT5 / OpenVoice)   │
│  Started by scripts/start-echo-clone.sh                     │
└─────────────────────────────────────────────────────────────┘
```

## Hardline modules (`web/src/`)

| Module | Role |
|--------|------|
| `echo-reader.js` | Entry re-export |
| `app.js` | DOM wiring shell (profiles, file import, event binding) |
| `playback.js` | Readback controller (system voices + online TTS) |
| `dictation.js` | Dictation controller (mic / import → STT → transcript) |
| `config.js` | Endpoints, limits, profile ids |
| `profiles.js` | PROFILE_CATALOG |
| `text.js` | Normalize / chunk / meta |
| `state.js` | localStorage draft |
| `files.js` | Client file extract |
| `surface.js` | Word surface + waveform |
| `browser-voices.js` | speechSynthesis matching |
| `echo-dictation-utils.js` | Audio normalize for STT |
| `echo-file-to-mp3.js` | Optional offline file→mp3 tool |

## Speech policy

1. Prefer **Workers AI** (Aura) when neurons remain.
2. On AI failure (incl. free-tier 4006), Worker falls back to **ECHO_CLONE_TTS_URL**.
3. Hardline sample profiles (echo / patricia / martin-*) prefer clone first for true speaker colour.
4. Never return bare HTTP 502 from the site proxy (CF strips the body).

## Non-goals of this refactor

- Replacing Expo with hardline (both stay).
- Enabling Workers Paid (operator billing decision).
- Named Cloudflare Tunnel (still trycloudflare via start script).
- Deleting Python backend (clone + local providers remain).

## Deploy

```bash
bash scripts/start-echo-clone.sh   # optional durability
bash scripts/deploy-cf.sh          # edge + Expo static
bash scripts/sync-echo-to-site.sh
cd ../martinlepage26-bit.github.io && npm run deploy:site
```
