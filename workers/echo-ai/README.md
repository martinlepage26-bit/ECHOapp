# echo-ai — Cloudflare Workers AI speech edge for ECHO

Runs **Deepgram Aura-2** TTS and **Whisper large-v3-turbo** STT on Cloudflare Workers AI, with the same route shapes the ECHO Python backend uses.

## Routes

| Method | Path | Auth | Response |
|--------|------|------|----------|
| GET | `/api/` | no | health |
| GET | `/api/voices` | no | `{ voices, default, provider }` |
| POST | `/api/tts/generate` | key when set | ECHO `TTSResponse` JSON (base64 audio) |
| POST | `/api/stt/transcribe` | key when set | ECHO `STTResponse` JSON |
| POST | `/api/echo-tts` | key when set | raw audio bytes (legacy site) |
| POST | `/api/echo-transcribe` | key when set | legacy transcript JSON |

## Deploy

```bash
cd workers/echo-ai
npm install
npx wrangler login          # once
npx wrangler secret put ECHO_API_KEY
npx wrangler deploy
```

Copy the printed `*.workers.dev` URL into the ECHO backend:

```env
SPEECH_PROVIDER=workers_ai
WORKERS_AI_URL=https://echo-ai.<account>.workers.dev
WORKERS_AI_TOKEN=<same value as ECHO_API_KEY secret>
```

## Local

```bash
npx wrangler dev
# WORKERS_AI_URL=http://127.0.0.1:8787
```

Workers AI models are billed on the Cloudflare account (Aura-2 is character-metered). Pair with `ECHO_API_KEY` on any public hostname.
