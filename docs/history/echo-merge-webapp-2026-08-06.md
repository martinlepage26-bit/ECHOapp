# ECHO merge under web-apps + deploy — 2026-08-06

## Request

Find all Echo occurrences, merge into one under web-apps, deploy on `martin.govern-ai.ca/echo`.

## What was merged into `web-apps/ECHOapp`

| Absorbed from site | Canonical path |
|--------------------|----------------|
| Hardline HTML shell | `web/index.html` |
| Reader / dictation / file-to-mp3 sources | `web/src/*` |
| Standalone CSS + voice samples | `web/echo-standalone.css`, `web/public/voices/` |
| Pages Function proxies (copies) | `web/pages-functions/` |
| Old `echo-tts-online` Worker | `workers/legacy-echo-tts-online/` (archived) |

Already present (kept):

- `workers/echo-ai` — live speech + Expo assets
- `frontend/` — Expo app
- `backend/` — Python providers

## Site role after merge

`martinlepage26-bit.github.io` no longer owns Echo product source:

- `scripts/build-echo-reader.mjs` → builds/syncs from `ECHOapp/web`
- `src/scripts/echo-*.js` → stubs pointing at ECHOapp
- `src/pages/echo/` → removed (static `public/echo/` only)
- Pages Functions still host `/api/echo-tts` and `/api/echo-transcribe` (must live on the Pages project); they proxy to `echo-ai`

## Deployed

| Target | Result |
|--------|--------|
| `https://martin.govern-ai.ca/echo/` | Hardline shell live; design-lock needles pass |
| `https://echo-ai.martinlepage26.workers.dev` | Worker redeployed (`50ca38fa-…`) |
| Site Pages | `https://1c99d2ba.martin-lepage-site.pages.dev` → production domains |

## Commands

```bash
# Web surface → site public/echo
bash /home/martin/work/web-apps/ECHOapp/scripts/sync-echo-to-site.sh
cd /home/martin/work/martinlepage26-bit.github.io && npm run deploy:site

# Speech worker
bash /home/martin/work/web-apps/ECHOapp/scripts/deploy-cf.sh
```
