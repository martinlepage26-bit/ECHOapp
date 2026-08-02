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
| GET | `/api/` | no | health (`storage: "d1"` once bound) |
| GET | `/api/voices` | no | `{ voices, default, provider }` |
| GET | `/api/sample-text` | no | sample draft |
| POST | `/api/tts/generate` | key when set | ECHO `TTSResponse` JSON |
| POST | `/api/stt/transcribe` | key when set | ECHO `STTResponse` JSON, auto-saved to D1 when bound |
| GET/POST | `/api/drafts` | key when set | requires `env.DB`; 503 with setup hint otherwise |
| DELETE | `/api/drafts/:id` | key when set | requires `env.DB` |
| GET/POST | `/api/transcripts` | key when set | requires `env.DB`; 503 with setup hint otherwise |
| DELETE | `/api/transcripts/:id` | key when set | requires `env.DB` |
| POST | `/api/parse-file` | key when set | `.txt`/`.md`/`.docx` extracted on the edge; `.pdf` → 415 (not supported here — paste text or use the Python API) |

## Library storage (D1)

Drafts/transcripts/parse-file need a bound D1 database. One-time setup:

```bash
npx wrangler d1 create echo-ai-db
# copy the returned database_id into wrangler.toml's [[d1_databases]] block, then:
npx wrangler d1 execute echo-ai-db --remote --file=migrations/0001_init.sql
```

Until the binding is added, those three routes return a clear 503 instead of failing silently.

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
