# ECHO

Canonical product tree for the ECHO voice reader.

## Surfaces

| Path | What |
|------|------|
| `web/` | Hardline browser UI → **https://martin.govern-ai.ca/echo/** |
| `workers/echo-ai/` | Cloudflare Workers AI speech + Expo static assets |
| `frontend/` | Expo app (Readback / Dictation / Library) |
| `backend/` | Python API for local/dev providers |

## Deploy

```bash
# 0) Optional but recommended: local SpeechT5 clone (survives free Workers AI neuron caps)
bash scripts/start-echo-clone.sh

# 1) Speech stack (workers.dev) — also picks up backend/.clone-tunnel-url as ECHO_CLONE_TTS_URL
bash scripts/deploy-cf.sh

# 2) Hardline /echo on martin.govern-ai.ca
bash scripts/sync-echo-to-site.sh
cd ../martinlepage26-bit.github.io && npm run deploy:site
```

**Speech durability:** Workers AI is preferred when neurons remain. When free allocation is exhausted (error 4006), the Worker and site proxy fall back to the clone origin. Keep `start-echo-clone.sh` running on this host for production readback.

See `docs/inventory/echo-surfaces-2026-08-06.md` and `docs/handoff/echo-durable-speech-repair-2026-08-07.md`.
