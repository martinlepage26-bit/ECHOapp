# ECHO durable speech repair — 2026-08-07

## Request

Hephaistos + Gadget: repair ECHO once and for all.

## Root cause (verified live)

1. **Workers AI free neurons exhausted** (`4006: you have used up your daily free allocation of 10,000 neurons`).
2. Pure Aura / Worker TTS path returned **HTTP 502** for every non-clone voice.
3. Cloudflare **Pages rewrote bare 502** responses into `error code: 502` and **stripped the JSON body**, so the hardline UI could not show a useful error.
4. Sample profiles (Echo / Patricia / Martin EN / FR) still worked only because Pages Functions preferred the **SpeechT5 clone** origin over Workers AI.

This is the same failure class first recorded in `echo-workers-ai-2026-08-01.md` — the stack was correct, but production still treated free Workers AI as a hard dependency.

## Artifact scope (HEPHAISTOS)

**Done means:** every hardline and Worker TTS voice id returns usable audio when the local clone origin is up, even if Workers AI neurons are exhausted. Workers AI remains preferred when available; clone is a mandatory fallback, not an optional demo path.

## What shipped

| Layer | Change |
|-------|--------|
| `workers/echo-ai/src/worker.js` | Workers AI → on failure, `ECHO_CLONE_TTS_URL` SpeechT5 clone with Aura→sample mapping; errors as **503** JSON (not 502); sample voices first-class in catalog |
| `workers/echo-ai/wrangler.toml` | `account_id` pinned for non-interactive deploy |
| Worker secrets | `ECHO_CLONE_TTS_URL` + `ECHO_API_KEY` set on `echo-ai` |
| `web/pages-functions/echo-tts.js` | Sample→clone first; Worker second; clone rescue for *all* voices; never emit bare 502 |
| Site Pages | Function synced + `npm run deploy:site` (deployment `628703b5…`) |

## Deployed

| Target | Result |
|--------|--------|
| `https://echo-ai.martinlepage26.workers.dev` | Version `e3f560a1-5e25-4252-9e3b-ea47f3389270` |
| `https://martin.govern-ai.ca/echo/` | Hardline shell 200 |
| `POST https://martin.govern-ai.ca/api/echo-tts` | All probed voices **200 audio/wav** |

### Live TTS matrix (post-repair)

| voice_id | HTTP | via | backend |
|----------|------|-----|---------|
| echo | 200 | clone | SpeechT5-clone |
| patricia | 200 | clone | SpeechT5-clone |
| martin-en | 200 | clone | SpeechT5-clone |
| martin-fr | 200 | clone | SpeechT5-clone |
| athena | 200 | worker | SpeechT5-clone (AI out → clone map) |
| luna | 200 | worker | SpeechT5-clone |
| orion | 200 | worker | SpeechT5-clone |
| apollo | 200 | worker | SpeechT5-clone |
| system | 200 | worker | SpeechT5-clone |

## Architecture after repair

```
Browser (martin.govern-ai.ca/echo)
  → Pages Function /api/echo-tts
      1. sample voice → SpeechT5 clone (trycloudflare tunnel → mtl-00 :8099)
      2. Worker echo-ai (Workers AI if neurons available)
      3. rescue → clone with Aura→sample map

Expo UI (echo-ai.workers.dev)
  → Worker /api/tts/generate | /api/echo-tts
      1. Workers AI
      2. same clone secret fallback
```

## Residual risk (honest, not hidden)

| Risk | Mitigation now | Still open |
|------|----------------|------------|
| Free Workers AI 4006 daily | Clone fallback on Worker + Pages | Enable Workers Paid if pure Aura colour is required |
| Ephemeral `trycloudflare.com` tunnel | `scripts/start-echo-clone.sh` rewrites Pages + should rewrite Worker secret | Named Cloudflare Tunnel + systemd for reboot survival |
| Clone process dies on host | Process was live during repair (uvicorn + cloudflared) | Operator restart via `start-echo-clone.sh` |
| Dictation (STT) still needs Workers AI Whisper | Unchanged this turn | Same neuron quota; fails closed when exhausted |

## Operator commands

```bash
# Speech worker (uses OAuth wrangler config; do not export limited publicsurface token)
cd /home/martin/work/web-apps/ECHOapp
unset CLOUDFLARE_API_TOKEN
bash scripts/deploy-cf.sh

# Clone origin + Pages secrets (also put Worker secret after this repair)
bash scripts/start-echo-clone.sh
# then:
TUNNEL=$(cat backend/.clone-tunnel-url)
printf '%s' "$TUNNEL" | npx wrangler secret put ECHO_CLONE_TTS_URL \
  --config workers/echo-ai/wrangler.toml

# Hardline site
bash scripts/sync-echo-to-site.sh
cd /home/martin/work/martinlepage26-bit.github.io && npm run deploy:site
```

## Acceptance (met)

- [x] Root cause named with live evidence (4006 + bare 502 strip)
- [x] Worker TTS works for Aura ids while neurons exhausted
- [x] Site proxy returns audio for sample + Aura ids
- [x] Errors no longer depend on bare CF 502 text
- [x] Handoff written; residual tunnel fragility explicit

## Code-review follow-up (2026-08-07, same day)

Structural cleanup after strict review (no behavior change):

| Before | After |
|--------|-------|
| `worker.js` ~986 lines with TTS + HTTP + D1 mixed | `worker.js` ~581 + `tts.js` ~383 (TTS owns durability) |
| Pages Function re-implemented full Aura→sample map + triple rescue | Thin proxy: sample→clone, else Worker, one echo rescue if Worker down |
| Silent `.catch(() => null)` on clone failure | Dual AI+clone errors composed into one message |
| `tryClone` returned `Response \| null \| {failed}` | `Response \| null` only |

Deployed: Worker `ad3f5441-…`, Pages `37354bdf…`.
