# echo-ai — ECHO on Cloudflare Workers

Full public stack on one hostname:

- **UI:** Expo web export (`frontend/dist`) via Workers Static Assets
- **Speech:** Deepgram Aura-2 TTS + Whisper large-v3-turbo STT (`env.AI`)
- **API shape:** same `/api/*` routes the Expo app already calls

Live: https://echo-ai.martinlepage26.workers.dev/readback

## Routes

| Method | Path | Auth | Response |
|--------|------|------|----------|
| GET | `/`, `/readback`, … | no | static UI |
| GET | `/api/` | no | health |
| GET | `/api/voices` | no | `{ voices, default, provider }` |
| GET | `/api/sample-text` | no | sample draft |
| POST | `/api/tts/generate` | key when set | ECHO `TTSResponse` JSON |
| POST | `/api/stt/transcribe` | key when set | ECHO `STTResponse` JSON |
| * | `/api/drafts`, `/api/transcripts`, `/api/parse-file` | — | 503 (Python/Mongo only) |

## Deploy (recommended)

From repo root (builds UI + deploys Worker + syncs secret):

```bash
bash scripts/deploy-cf.sh
```

Requires `ECHO_API_KEY` in `backend/.env` (baked into the web bundle and stored as a Worker secret).

## Local Worker only

```bash
cd workers/echo-ai
npm install
npx wrangler dev
```

Workers AI is billed on the Cloudflare account (Aura-2 is character-metered).
