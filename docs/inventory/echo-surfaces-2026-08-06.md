# ECHO surface inventory and merge (2026-08-06)

## Canonical home

**`/home/martin/work/web-apps/ECHOapp`**

| Path | Role |
|------|------|
| `web/` | Hardline browser UI for `https://martin.govern-ai.ca/echo/` |
| `workers/echo-ai/` | Speech API + optional Expo static assets (`echo-ai.*.workers.dev`) |
| `frontend/` | Expo Router app (mobile + optional full-tab web) |
| `backend/` | Python FastAPI (local/dev providers, clone TTS) |
| `workers/legacy-echo-tts-online/` | Archived pre-merge Worker (superseded by `echo-ai`) |
| `web/pages-functions/` | Canonical copies of Pages Function proxies |

## Pre-merge locations (absorbed)

| Location | Status after merge |
|----------|-------------------|
| `martinlepage26-bit.github.io/src/pages/echo/` | Generated/synced from `ECHOapp/web` |
| `martinlepage26-bit.github.io/src/scripts/echo-*.js` | Stubs → `ECHOapp/web/src` |
| `martinlepage26-bit.github.io/public/echo/` | Build output synced from `ECHOapp/web/dist/echo` |
| `martinlepage26-bit.github.io/workers/echo-tts-online/` | Archived under `ECHOapp/workers/legacy-echo-tts-online` |
| `martinlepage26-bit.github.io/functions/api/echo-*.js` | Thin proxies; source of truth mirrored in `web/pages-functions` |
| `echo-ai.martinlepage26.workers.dev` | Live speech + Expo stack (unchanged account) |

## Deploy

```bash
# Speech worker (Workers AI + D1 + Expo assets at workers.dev)
cd /home/martin/work/web-apps/ECHOapp && bash scripts/deploy-cf.sh

# Hardline /echo on martin.govern-ai.ca
cd /home/martin/work/web-apps/ECHOapp && bash scripts/sync-echo-to-site.sh
cd /home/martin/work/martinlepage26-bit.github.io && npm run deploy:site
```

## Design lock

Site smoke (`scripts/gaia-echo-locks.mjs`) still requires the hardline reader markers on `/echo/`. Do not replace that shell with the Expo tab UI without updating the lock intentionally.
