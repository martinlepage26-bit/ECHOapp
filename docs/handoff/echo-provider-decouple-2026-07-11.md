# ECHO Provider Decouple + Live Deploy

- Date: `2026-07-11`
- Branch: `codex/echo-web-bugfixes`
- Commit hashes: **none — changes left uncommitted in the working tree**
- Live URL: `https://mechanics-masters-doll-corpus.trycloudflare.com`
  (ephemeral cloudflared quick tunnel → `127.0.0.1:8099`; dies when the process stops)

## Status: ECHO IS LIVE AND SPEAKING

The record shows, verified through the public URL:

- `GET /` serves the Expo web app (HTTP 200)
- `GET /api/voices` returns 7 ElevenLabs voices, `provider: elevenlabs`
- `POST /api/tts/generate` **without** a key returns HTTP 401
- `POST /api/tts/generate` **with** the key returns a 145,075-byte MP3
  (`ID3` / MPEG layer III / 128 kbps / 44.1 kHz, confirmed by `file`), markdown normalized
  (`# ECHO is live` is spoken as "ECHO is live.", not as a hash symbol)

This is the first time ECHO has produced real speech from a running backend.

## Why This Was Needed

The record shows ECHO was scaffolded on the Emergent platform (`.emergent/emergent.yml`,
`env_image_name: expo_mongo_base_image_cloud_arm`) and is now orphaned from it.

`backend/server.py` imported `emergentintegrations`, a proprietary package on Emergent's
private index, not on public PyPI. It is not installed in the project's own venv
(`~/.venvs/echoapp`) and cannot be. **The backend therefore could not import at all** —
every request path was dead before it started.

This is the root cause of "Codex tried to fix it, nothing happened." The prior session's
work (`docs/handoff/echo-readback-browser-smoke-2026-07-11.md`) verified the readback flow
against a **local mock API**, never a running backend, so a hard import failure sat
underneath a set of passing browser checks.

## What Is Done

- Removed the `emergentintegrations` import and the `EMERGENT_LLM_KEY` client construction
  from `backend/server.py`. Zero references remain in backend source.
- Removed `emergentintegrations==0.1.0` from `backend/requirements.txt` (it would fail any
  fresh `pip install -r`).
- Added `backend/speech_providers.py`: a provider abstraction behind the two call sites the
  server actually used (synthesize, transcribe) plus a voice catalog.
  - `SPEECH_PROVIDER=elevenlabs` (default) — TTS via ElevenLabs, STT via Scribe. Voice
    catalog fetched live from the account and cached.
  - `SPEECH_PROVIDER=openai` — TTS via `tts-1`, STT via `whisper-1`. The catalog ECHO
    originally shipped against.
  - Swapping providers is one env var. No code change.
- Made Mongo **lazy**. `os.environ["MONGO_URL"]` at module level meant a missing var killed
  the entire app, including endpoints that need no database. Storage now resolves on first
  use and returns a clean `503` if unconfigured.
- Fixed the shutdown handler, which still referenced the old module-global client and would
  have raised `NameError` on every shutdown.
- Fixed a latent voice-id bug: `server.py` fell back to a hardcoded `"echo"` for unknown
  voices. ElevenLabs voice ids are opaque hashes, so that fallback would have sent an
  invalid voice on every miss. It now falls back to the **provider's own default**.
- Word timings now scale by the speed the provider **actually applied**, not the speed
  requested. ElevenLabs clamps speed to 0.7–1.2 while the frontend offers 0.5–2.0; scaling
  by the requested value would drift the readback highlight out of sync with the voice.
- Added `backend/.env.example` documenting every variable (no secrets).
- **Preserved the prior session's work**: `backend/speech_text.py` (markdown normalization,
  word-timing estimation), the `readback.tsx` web replay guard, and `test_speech_text.py`
  are untouched and green.
- Rewrote `backend/tests/test_server_tts_unit.py`, which mocked `emergentintegrations` and
  could no longer run. Its two real assertions — markdown is cleaned before speech, and an
  unknown voice falls back to the default — are preserved and now vendor-agnostic. Added
  three tests: known-voice passthrough, speed-clamp timing scale, and 503-on-missing-key.

## Verification Commands And Results

Interpreter: `~/.venvs/echoapp/bin/python` (the project venv — it already contains
`elevenlabs 2.45.0`, `openai 1.99.9`, `fastapi`, `motor`, `uvicorn`, `pytest`).

- `env -u MONGO_URL -u DB_NAME python -c "import server"`
  - result: `IMPORT OK — app boots with zero config` (previously: `ModuleNotFoundError`)
- `python -m pytest tests/test_server_tts_unit.py tests/test_speech_text.py -q`
  - result: `7 passed, 11 warnings in 0.31s`
- `uvicorn server:app --port 8099` then `curl /api/`
  - result: `{"service":"echo","status":"online"}`
- `curl /api/voices` (ElevenLabs selected, no key present)
  - result: `HTTP 503` — `{"detail":"elevenlabs is selected but ELEVENLABS_API_KEY is not
    set. Add ELEVENLABS_API_KEY to backend/.env, or set SPEECH_PROVIDER to a configured
    provider."}` — degrades cleanly, does not crash
- `curl -X POST /api/drafts -d '{"title":"smoke","text":"hello from the real backend"}'`
  - result: `HTTP 200`, id `9999ba25-…`; `GET /api/drafts` returned the same record.
    **Mongo round-trips against the dockerized instance on `127.0.0.1:27019`.**
- `SPEECH_PROVIDER=openai uvicorn server:app --port 8098` then `curl /api/voices`
  - result: `HTTP 200`, nine OpenAI voices, `"default":"echo"`, `"provider":"openai"` —
    the one-env-var swap is real

## Corrections To The Prior Record

- The earlier handoff reported no usable backend runtime. In fact `~/.venvs/echoapp` already
  contains the full dependency surface; **only** `emergentintegrations` was missing.
- The earlier handoff reported no MongoDB. In fact a **MongoDB container is running** and
  reachable at `127.0.0.1:27019` (no system `mongod`, which is what an earlier check looked
  for). Storage works today.

## The ElevenLabs Key Is Scope-Limited (and the code now handles it)

Martin's key **cannot read the account voice catalog**. Probed directly:

- `GET /v1/voices` → 401 `missing the permission voices_read`
- `GET /v1/models` → 401 `missing the permission models_read`
- `GET /v1/user`   → 401 `missing the permission user_read`
- `POST /v1/text-to-speech/{id}` → **200, real MP3** — synthesis works

It is a synthesis-only key. That is sufficient to run ECHO, so `ElevenLabsProvider` now
degrades: it tries the live catalog, and on any failure falls back to a stock voice list
whose ids were each **individually confirmed to synthesize with this key** (Rachel, Sarah,
George, Daniel, Bill, Callum, Charlotte — Liam `TX3LSARhy5PsA7qeIz6O` returned 404 and was
dropped). Listing voices must never be a hard dependency of speaking.

To serve the account's own voices instead, grant the key `voices_read` in the ElevenLabs
dashboard. No code change needed; the live path is already there.

## Deploy Shape

- One origin. FastAPI mounts the exported Expo web build (`frontend/dist`) at `/`, so the
  app and the API share a host. One URL to publish, and no CORS surface.
- Shared-secret gate: `POST /api/tts/generate`, `/api/stt/transcribe`, and `/api/parse-file`
  require `X-Echo-Key` matching `ECHO_API_KEY` (constant-time compare). `GET /api/voices`
  and `/api/sample-text` stay open — they cost nothing. The gate enforces only when
  `ECHO_API_KEY` is set, so local dev stays frictionless; the server logs a loud warning
  when it is unset.

## Risks

- `high` **The shared secret is readable in the shipped JS bundle.** Confirmed: `grep` finds
  `ECHO_API_KEY` inside `frontend/dist/`. This is inherent to a public single-page app that
  calls a metered backend — the browser must hold the key, so anyone who loads the page can
  extract it and then call `/api/tts/generate` directly, spending ElevenLabs credits.
  What the gate **does** stop: bots and scanners that find the API without the page. What it
  **does not** stop: anyone Martin sends the link to. **Treat the URL itself as the secret.**
  If ECHO ever goes on a stable public hostname, this is not sufficient — put Cloudflare
  Access in front of it, or add per-user auth and rate limiting.
- `medium` **Cost exposure is unquantified.** ElevenLabs bills per character, and ECHO's
  entire purpose is reading back long drafts — the most character-hungry workload there is.
  The exact per-character rates and Martin's current plan limits were **not verified** in
  this session and must not be assumed. The structural point stands: ElevenLabs is the
  premium option, OpenAI `tts-1` is materially cheaper for the same text, and the
  abstraction means switching costs one env var. **Unresolved: what a month of real ECHO
  usage costs on each.**
- `low` The frontend still sends `voice_id: "echo"` as its hardcoded default. The backend
  now absorbs this safely (unknown id → provider default), so nothing 400s, but the
  frontend default should be updated to read from `/api/voices` rather than assume an
  OpenAI-era id.
- `low` `MAX_TTS_CHARS = 4000` was chosen against OpenAI's 4096 limit. It is a reasonable
  guard for any provider but is no longer tied to the selected vendor's real limit.

## How To Restart The Live URL

The quick tunnel is ephemeral. It dies with its process and comes back on a **new** random
hostname. To bring ECHO back up:

```bash
cd ~/apps/web-apps/ECHOapp/backend
~/.venvs/echoapp/bin/uvicorn server:app --host 127.0.0.1 --port 8099 &
cloudflared tunnel --url http://127.0.0.1:8099 --no-autoupdate   # prints the new URL
```

If `ECHO_API_KEY` is ever rotated in `backend/.env`, the web bundle must be rebuilt, because
the key is compiled into it:

```bash
cd ~/apps/web-apps/ECHOapp/frontend
export PATH=/home/martin/.nvm/versions/node/v20.20.2/bin:$PATH   # Node 18 cannot run Metro
set -a; . ../backend/.env; set +a
CI=1 EXPO_PUBLIC_BACKEND_URL="" EXPO_PUBLIC_ECHO_KEY="$ECHO_API_KEY" \
  npx expo export --platform web --output-dir dist
```

## Next Decision

1. **Listen to it.** Open the live URL, paste a draft, press play. The engineering is
   verified; whether the *voice* is right for ECHO is Martin's judgment, not a test's.
   Rachel is the current default purely because she was first in the validated list.
   `ELEVENLABS_DEFAULT_VOICE` in `backend/.env` changes it with no code edit.
2. **Decide the provider on cost, not on default.** Verify current ElevenLabs vs OpenAI TTS
   pricing against expected ECHO usage. ElevenLabs is character-billed and ECHO reads long
   drafts. `SPEECH_PROVIDER=openai` + `OPENAI_API_KEY` switches it with no code change.
3. **Grant `voices_read`** on the ElevenLabs key if the account's own voices should appear
   instead of the stock seven.
4. **Commit.** Everything is uncommitted on `codex/echo-web-bugfixes`, now mixing the prior
   session's work with this one's. The prior session's work was never committed either,
   which is a large part of why it read as "nothing happened."
5. **Follow-up worth taking:** ElevenLabs returns real character-level timestamps
   (`convert_with_timestamps`). ECHO currently *estimates* word timings. Using the real ones
   would put readback highlighting exactly in sync with the voice — the explicit
   accessibility commitment in `PRODUCT.md`. Deliberately left out of scope to keep this
   change surgical.
