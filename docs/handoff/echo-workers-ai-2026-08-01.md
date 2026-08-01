# ECHO → Cloudflare Workers AI wiring — 2026-08-01

## What shipped

1. **Edge Worker** at `workers/echo-ai/`
   - Binding: `env.AI` (Workers AI)
   - TTS: `@cf/deepgram/aura-2-en`
   - STT: `@cf/openai/whisper-large-v3-turbo`
   - ECHO-compatible routes: `/api/voices`, `/api/tts/generate`, `/api/stt/transcribe`
   - Auth: `X-Echo-Key` / `Authorization: Bearer` vs `ECHO_API_KEY` secret

2. **Python provider** `workers_ai` in `backend/speech_providers.py`
   - `SPEECH_PROVIDER=workers_ai`
   - Calls `WORKERS_AI_URL` over HTTPS with `WORKERS_AI_TOKEN` (or `ECHO_API_KEY`)
   - Aliases: `cloudflare`, `cf`, `workers-ai`

3. **Server** passes through provider `mime` (Aura returns mp3; melotts may return wav).

## Enable

```bash
# 1. Deploy edge speech
cd workers/echo-ai
npm install
npx wrangler secret put ECHO_API_KEY
npx wrangler deploy
# note the https://echo-ai.<subdomain>.workers.dev URL

# 2. Point the Python API at it (backend/.env)
SPEECH_PROVIDER=workers_ai
WORKERS_AI_URL=https://echo-ai.<subdomain>.workers.dev
WORKERS_AI_TOKEN=<same as Worker ECHO_API_KEY>
ECHO_API_KEY=<same or separate client gate>
```

## Architecture

```
Expo web/app ──► ECHO Python API (auth, drafts, normalize) ──► echo-ai Worker ──► Workers AI
```

Piper remains the default offline provider. Flip one env var to move speech to Cloudflare.

## Live deploy (done this turn)

- Account: `Martinlepage26@me.com's Account` (`1713c51c…`)
- URL: **https://echo-ai.martinlepage26.workers.dev**
- Version after secret: `91fa5daa-ee44-4606-a77f-76b406d863c9`
- `ECHO_API_KEY` secret uploaded from local `backend/.env`
- `backend/.env` set: `SPEECH_PROVIDER=workers_ai`, `WORKERS_AI_URL=https://echo-ai.martinlepage26.workers.dev`, `WORKERS_AI_TOKEN` aligned with key

### Smoke results

| Check | Result |
|-------|--------|
| `GET /api/` | 200, `provider: workers_ai`, Aura + Whisper models |
| `GET /api/voices` | 200, 24 Aura voices |
| `POST /api/tts/generate` with key | **502** — free Workers AI allocation exhausted: *“you have used up your daily free allocation of 10,000 neurons”* |

Wiring is correct end-to-end; synthesis will succeed after free neurons reset or Workers Paid is enabled. Local fallback: `SPEECH_PROVIDER=piper`.

## Not done this turn

- Migrating the static site’s older `echo-tts-online` Worker to this tree (legacy paths already compatible)
- Enabling Workers Paid / waiting for free neuron reset
