# ECHO

Browser-native voice reader: paste or import text, listen with word tracking, dictate, store drafts.

**Canonical tree:** `/home/martin/work/web-apps/ECHOapp`  
**Public hardline:** https://martin.govern-ai.ca/echo/  
**Edge + Expo:** https://echo-ai.martinlepage26.workers.dev/

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the modular layout.

## Layout

| Path | Role |
|------|------|
| `web/` | Hardline browser UI (modular `web/src/*`) |
| `workers/echo-ai/` | Edge speech API + Expo static assets |
| `frontend/` | Expo Readback / Dictation / Library |
| `backend/` | Local SpeechT5 clone + optional providers |
| `scripts/` | Deploy, clone tunnel, site sync |

## Deploy

```bash
# 0) Local clone (survives free Workers AI neuron caps)
bash scripts/start-echo-clone.sh

# 1) Edge speech + Expo static
bash scripts/deploy-cf.sh

# 2) Hardline /echo on martin.govern-ai.ca
bash scripts/sync-echo-to-site.sh
cd ../martinlepage26-bit.github.io && npm run deploy:site
```

## Dev

```bash
# Hardline bundle only
cd web && npm run build

# Edge local
cd workers/echo-ai && npx wrangler dev

# Python API / clone
cd backend && .venv/bin/uvicorn server:app --host 127.0.0.1 --port 8099
```

## Product

See [PRODUCT.md](./PRODUCT.md).
