# ECHO — Radical Simplification Redesign

> Lead-architecture deliverable: review the current system, propose the simplest possible architecture, and give an incremental migration plan.
>
> Constraints confirmed by the owner:
> 1. **No paid Cloudflare Workers AI.** The system must stay on the free tier.
> 2. **Custom clone voices are non-negotiable.** `echo`, `patricia`, `martin-en`, and `martin-fr` must remain available.
> 3. **Remove voice dictation.** STT / transcription is out of scope.
>
> Removing dictation eliminates the only feature that required a separate speech modality. The system is now: read text, import files, listen, save drafts. One speech direction, one UI concern, one failure surface.

---

## A. Architecture Review

### Highest-impact problems

| Rank | Problem | Evidence | Impact |
|------|---------|----------|--------|
| 1 | **Two complete UI implementations** — Expo (`frontend/`) and hardline web (`web/`) both implement readback, dictation, and library. | `frontend/app/(tabs)/{readback,dictation,library}.tsx` (~2,287 lines) duplicates the same flows already in `web/src/{app,playback,dictation}.js` (~3,367 lines). | Every feature is built twice. Bugs fixed in one surface stay in the other. Two build/deploy paths. |
| 2 | **Four overlapping speech authorities** — Python backend, `echo-ai` Worker, legacy online Worker, and Pages Function proxies each own TTS logic. | TTS logic in `backend/server.py` + `speech_providers.py` + `clone_tts.py` (~2,029 lines), `workers/echo-ai/src/tts.js` + `worker.js` (~980 lines), `workers/legacy-echo-tts-online/worker.js` (456 lines), `web/pages-functions/echo-tts.js` (234 lines). | Same responsibility in four codebases. Voice catalogs, auth, chunking, fallbacks, and error handling diverge. |
| 3 | **Hidden, cascading fallback chains** — TTS silently falls back through Pages → Worker → clone, and Worker → Workers AI → clone. | Handoff TTS matrix shows every voice returned `backend: "SpeechT5-clone"`; Workers AI served zero requests. | Voice selection is fake. Failures are masked. Operators cannot tell which component is actually serving traffic. |
| 4 | **Backend does too many jobs** — `backend/server.py` is API router, web server, speech-orchestrator, provider switchboard, file parser, storage layer, and rate limiter. | 741 lines, imports `speech_providers`, `clone_tts`, Motor, FastAPI, pydantic, pypdf, python-docx. | One file owns unrelated responsibilities; the clone engine is welded to Mongo, web serving, and provider plumbing. |
| 5 | **Two storage backends for the same data** — MongoDB via Python backend and D1 via Worker. | `backend/server.py` uses Motor/Mongo; `workers/echo-ai/src/storage.js` uses D1. | Library only works on the Worker path; data model duplicated; two persistence failure modes. |
| 6 | **File parsing implemented three times** — Python (`pypdf`/`python-docx`), Worker (`unpdf`/`fflate`), and browser (`pdfjs-dist`/`mammoth`). | `backend/server.py`, `workers/echo-ai/src/parse.js`, `web/src/files.js`. | Behavior differs by surface. Three dependency sets. Browser parsing is unnecessary when the API can parse. |
| 7 | **Manual, fragile deployment and cache busting** — hand-typed `?v=20260801-bracefix2`, rsync to a second repo, separate Worker + Pages + site deploys. | `web/index.html`, `scripts/sync-echo-to-site.sh`, `scripts/deploy-cf.sh`. | Browsers run stale JS. Git history in `martinlepage26-bit.github.io` does not match what is live. |
| 8 | **Configuration/state sprawl** — `SPEECH_PROVIDER`, `ECHO_CLONE_TTS_URL`, `WORKERS_AI_URL`, `ECHO_TTS_WORKER_URL`, `ECHO_STT_WORKER_URL`, `ECHO_API_KEY`, etc., in backend, Worker, Pages, and UI bundles. | `.env.example`, `wrangler.toml`, Pages Function env, systemd units. | Drift, secrets mismatches, and “works on my tunnel” debugging. |
| 9 | **Auth gate duplicated** — `backend/server.py`, `workers/echo-ai/src/auth.js`, and both Pages Functions validate the same key differently. | `require_api_key`, `authorize`, `upstreamAuthHeaders`. | One surface can be left open while the others are locked. |
| 10 | **Historical baggage still in the tree** — stale PRD, archived legacy Worker, offline `echo-file-to-mp3.js`, Emergent-decouple notes. | `memory/PRD.md`, `workers/legacy-echo-tts-online/`, `web/src/echo-file-to-mp3.js`, handoff files. | Misleading documentation and dead code. |

### Architecture smells

- **Fake modularization**: `frontend/src/utils.ts` (22 lines) and `web/src/text.js` (199 lines) are both “text helpers,” but the real text logic is also duplicated in `backend/speech_text.py` (185 lines) and `workers/echo-ai/src/tts.js` (`estimateWordTimings`).
- **God modules**: `web/src/app.js` (858 lines), `backend/server.py` (741 lines), and `frontend/app/(tabs)/readback.tsx` (875 lines) mix presentation, state, API calls, and audio plumbing.
- **Leaky UI**: UI components know infrastructure details — `EXPO_PUBLIC_BACKEND_URL`, `ECHO_CLONE_TTS_URL`, `X-Echo-Key`, raw base64 handling, multipart FormData.
- **Mirrored state**: localStorage draft in web, AsyncStorage not used, Expo `pendingDraft` bus, D1 drafts, Mongo drafts — five places hold “draft.”
- **Adapter overload**: `speech_providers.py` abstracts ElevenLabs, OpenAI, Piper, Workers AI, and Clone, but the live system only uses Workers AI → clone. The abstraction costs more than it saves.

---

## B. New Architecture

### Decision: one UI, one Worker, one database, two explicit TTS providers, no STT

- **UI**: a single responsive web app (`ui/`) replacing both Expo and hardline. Mobile users use the browser/PWA; a native app can be a thin WebView wrapper later if truly required.
- **Runtime**: one Cloudflare Worker (`worker/`) serves static UI assets and `/api/*`. It is the only owner of speech routing, parsing, auth, and storage.
- **Speech providers**:
  - **Aura voices** (`athena`, `luna`, …) → Cloudflare Workers AI (`@cf/deepgram/aura-2-en`). Fails closed when the free quota is exhausted.
  - **Clone voices** (`echo`, `patricia`, `martin-en`, `martin-fr`) → local sidecar (`clone/`). Fails closed when the sidecar is unreachable.
  - No fallback between providers. The UI shows which provider serves each voice.
- **Storage**: Cloudflare D1 for drafts only. No transcripts.
- **Deploy**: `npm run build && npm run deploy` deploys the Worker + UI. The clone sidecar is deployed separately and is not in the critical path for Aura voices.

### Folder tree

```
ECHOapp/
├── README.md
├── package.json                 # root scripts: test, build, deploy
├── .env.example                 # single example for local dev
├── wrangler.toml                # Worker + assets binding + D1 binding
├── ui/                          # single web app
│   ├── index.html
│   ├── package.json
│   ├── vite.config.ts
│   ├── public/
│   └── src/
│       ├── main.tsx
│       ├── app.tsx              # shell + routing
│       ├── api.ts               # ONE HTTP client
│       ├── audio.ts             # playback helpers
│       ├── text.ts              # normalize / chunk / timings (UI side)
│       ├── store.ts             # local draft state
│       ├── components/
│       │   ├── Readback.tsx
│       │   ├── Library.tsx
│       │   └── VoiceSelect.tsx
│       └── styles/
│           └── echo.css         # one design system
├── worker/                      # one Cloudflare Worker
│   ├── src/
│   │   ├── index.ts             # router
│   │   ├── tts.ts               # routes to Workers AI or clone sidecar
│   │   ├── parse.ts             # file text extraction
│   │   ├── storage.ts           # D1 drafts
│   │   ├── auth.ts              # single API-key gate
│   │   └── http.ts              # CORS / JSON helpers
│   ├── migrations/
│   │   └── 0001_init.sql
│   ├── package.json
│   └── tsconfig.json
├── clone/                       # minimal local TTS sidecar for clone voices
│   ├── server.py                # tiny FastAPI: POST /tts, GET /health
│   ├── engine.py                # SpeechT5/OpenVoice engine (from clone_tts.py)
│   ├── voices/                  # echo.mp3, patricia.mp3, martin-en.mp3, martin-fr.mp3
│   ├── requirements.txt
│   └── systemd/
│       ├── echo-clone.service
│       └── echo-clone-tunnel.service
├── tests/
│   ├── ui/                      # Playwright E2E
│   └── worker/                  # Vitest + Miniflare unit tests
└── docs/
    └── architecture/
        └── redesign.md
```

No `utils/`, `helpers/`, `shared/`, `common/`, `legacy/`, `v2/`, `final/`, `fixed/`, or `clean/`.

### Module responsibilities

| Module | Inputs | Outputs | Failure modes |
|--------|--------|---------|---------------|
| `ui/src/api.ts` | endpoint path, payload | JSON or binary | 401 → show auth error; 503 from provider → show provider status |
| `ui/src/audio.ts` | audio base64 / blob, word timings | `<audio>` + highlight index | autoplay blocked → explicit second tap |
| `ui/src/text.ts` | raw markdown/text | cleaned text, word timings | invalid UTF-8 → sanitize |
| `ui/src/components/VoiceSelect.tsx` | voice catalog | user selection | disables voices whose provider is offline |
| `worker/src/tts.ts` | `{text, voice_id, speed}` + `env.AI` + `env.ECHO_CLONE_TTS_URL` | `{audio_base64, mime, words, duration}` | Workers AI quota → 503 `workers_ai_quota_exhausted`; clone unreachable → 503 `clone_unavailable` |
| `worker/src/parse.ts` | file bytes + filename | `{text, word_count, char_count}` | unsupported format → 415; corrupt → 422 |
| `worker/src/storage.ts` | D1 binding + draft payload | row or list | no DB binding → 503 |
| `worker/src/auth.ts` | request headers + `env.ECHO_API_KEY` | ok / 401 | constant-time compare |
| `clone/server.py` | `{text, voice_id, speed}` + `X-Echo-Key` | WAV bytes | unknown voice → 404; engine error → 503 |
| `clone/engine.py` | text, voice id | WAV bytes | missing sample/model → 503 |

### Request flow

```
User → DNS → Cloudflare Worker
            │
            ├── /, /assets/*  → static ui/dist (content-hashed by Vite)
            │
            └── /api/*        → router
                    ├── GET  /voices       → catalog with provider labels
                    ├── GET  /sample-text  → static sample
                    ├── POST /tts          → tts.ts  → Workers AI OR clone sidecar
                    ├── POST /parse        → parse.ts
                    ├── /drafts            → storage.ts (D1)
                    └── GET  /health       → provider status
```

### Speech pipeline (single router, explicit providers)

```
UI voice select
    │
    ├── Aura voice  ──POST /api/tts──►  worker tts.ts  ──env.AI.run()────►  Workers AI
    │
    └── Clone voice ──POST /api/tts──►  worker tts.ts  ──ECHO_CLONE_TTS_URL──►  clone sidecar
```

No Pages Functions, no Python backend, no Worker↔Worker proxying, no `trycloudflare.com` tunnel, no silent voice remapping.

A voice catalog entry now looks like:

```json
{
  "id": "echo",
  "name": "Echo",
  "provider": "clone"
}
```

```json
{
  "id": "athena",
  "name": "Athena",
  "provider": "workers_ai"
}
```

### Deployment flow

1. **Edge** (one command): `npm run build` → Vite builds `ui/dist`; `npm run deploy` → Wrangler deploys the Worker and serves `ui/dist` through the `[assets]` binding.
2. **Clone sidecar** (separate, documented): start `clone/systemd/echo-clone.service` + tunnel on the host. The sidecar is required only for the four clone voices.

Static assets are immutable (`Cache-Control: public, max-age=31536000, immutable`) because filenames contain hashes. `index.html` is revalidated. No manual `?v=` cache buster.

### Configuration strategy

- One source of runtime config: `wrangler.toml` vars and Wrangler secrets.
- Local development: root `.env` (gitignored) supplies `ECHO_API_KEY` to the UI build and `wrangler dev`.
- Clone sidecar config: `clone/.env` with `VOICE_SAMPLES_DIR`, `ECHO_API_KEY`, optional `ECHO_MODEL_CACHE`.
- No `backend/.env`, no Pages secrets, no `SPEECH_PROVIDER` switch, no tunnel URL rewriting on every restart.

| Variable | Where | Purpose |
|----------|-------|---------|
| `ECHO_API_KEY` | Wrangler secret + build-time env + clone sidecar | single shared gate |
| `ECHO_TTS_MODEL` | `wrangler.toml` `[vars]` | Workers AI TTS model |
| `ECHO_CLONE_TTS_URL` | Wrangler secret | clone sidecar origin |
| `DB` | `wrangler.toml` `[[d1_databases]]` | drafts |
| `AI` | `wrangler.toml` `[[ai]]` | Workers AI binding |

---

## C. Refactoring Plan

Each phase reduces complexity and leaves the system in a verifiable state.

### Phase 0 — Stop the bleeding (no user-facing change)

1. Delete `workers/legacy-echo-tts-online/` (archived duplicate Worker).
2. Delete generated directories: all `dist/`, `node_modules/`, `.venv/` (keep lockfiles).
3. Archive `docs/handoff/*.md` into `docs/history/` so the active tree stops mirroring 14 handoff files.
4. Add a root `.gitignore` rule that blocks future generated artifacts.
5. Freeze changes to the live sites; document that the old stack is being replaced.

**Verification**: `git ls-files` no longer contains legacy worker or handoff docs.

### Phase 1 — Isolate the clone engine

1. Create `clone/` directory.
2. Move `backend/clone_tts.py` → `clone/engine.py` (strip provider/storage/file-parse imports).
3. Write `clone/server.py` with exactly two routes: `POST /tts` and `GET /health`.
4. Write `clone/requirements.txt` containing only what the engine needs.
5. Move `backend/voices/` → `clone/voices/`.
6. Add `clone/systemd/` units that are self-contained.
7. Deploy the sidecar on `echo-clone-api.pharos-ai.ca` and verify curl TTS for all four clone voices.

**Verification**: `curl POST https://echo-clone-api.pharos-ai.ca/tts` returns WAV for `echo`, `patricia`, `martin-en`, `martin-fr`.

### Phase 2 — Build the single Worker runtime

1. Create `worker/` with TypeScript modules: `index.ts`, `tts.ts`, `parse.ts`, `storage.ts`, `auth.ts`, `http.ts`.
2. `tts.ts` routes by `voice_id`: Aura ids → `env.AI`; clone ids → `ECHO_CLONE_TTS_URL`.
3. `parse.ts` ports `workers/echo-ai/src/parse.js`.
4. `storage.ts` ports D1 logic from `workers/echo-ai/src/storage.js`, scoped to drafts only.
5. Add D1 migration `0001_init.sql`.
6. Add `wrangler.toml` with `AI`, `DB`, and `[assets]` binding.
7. Stand the Worker up with `wrangler dev` and verify every `/api/*` route with curl.

**Verification**: Worker-only test suite passes for TTS (both providers), parse, drafts, auth, health.

### Phase 3 — Build the single UI

1. Create `ui/` as a Vite + React app.
2. Implement two screens: Readback and Library. No Dictation tab.
3. Reuse the hardline visual design (`web/echo-standalone.css`) as the single CSS source.
4. Remove client-side file parsing; import goes to `/api/parse`.
5. Audio playback uses the Web Audio API / `<audio>` with blob URLs and explicit user-gesture handling.
6. Voice selector labels each voice with its provider and disables voices whose provider is offline.

**Verification**: Playwright E2E covers sample text, TTS playback, word highlight, file import, save/list/delete draft, and clone-voice TTS.

### Phase 4 — Cut over and delete old code

1. Point the production domain to the new Worker.
2. Delete:
   - `backend/` (engine already moved to `clone/`)
   - `frontend/`
   - `web/`
   - `workers/echo-ai/`
   - `workers/legacy-echo-tts-online/` (if not already deleted)
   - `scripts/`
   - `memory/PRD.md`
   - `voices.zip`
   - `web/src/echo-file-to-mp3.js`
3. Replace root `README.md` and `ARCHITECTURE.md`.
4. Update root `package.json` with one `build`, one `test`, one `deploy` script.

**Verification**: full E2E against the production URL passes; `git ls-files` count drops by ~75%.

### Phase 5 — Harden determinism

1. Add per-IP rate limiting in `worker/src/auth.ts`.
2. Add `/api/health` that reports provider status (Workers AI quota, clone reachable, D1 bound).
3. Add structured logging (`console` → request-id tagged logs).
4. Add unit tests for every `worker/src/` module and for `clone/engine.py`.

**Verification**: all tests green; health endpoint correctly reports quota exhaustion and clone sidecar status.

---

## D. Deletion List

### Code to remove

| Path | Why it goes |
|------|-------------|
| `backend/server.py` | API routing, web serving, storage, file parsing, and rate limiting move to the Worker. |
| `backend/speech_providers.py` | Provider abstraction is over-engineered. Only Workers AI and the clone sidecar remain, and the choice is explicit per voice. |
| `backend/speech_text.py` | Text normalization/timing moves into `worker/src/tts.ts` and `ui/src/text.ts`. |
| `backend/tests/` | Replaced by `tests/worker/` and `tests/clone/`. |
| `frontend/` | Expo React Native UI is replaced by the single web app in `ui/`. |
| `web/` | Hardline web UI and Pages Function proxies are replaced by `ui/` and `worker/`. |
| `workers/echo-ai/` | Current Worker is replaced by the slimmer `worker/` with explicit provider routing. |
| `workers/legacy-echo-tts-online/` | Archived duplicate Worker; no live role. |
| `scripts/` | `deploy-cf.sh`, `sync-echo-to-site.sh`, `start-echo-clone.sh`, `run-local.sh` collapse into root `package.json` scripts and `clone/systemd/` docs. |
| `voices.zip` | Sample MP3s live in `clone/voices/`. |
| `web/src/echo-file-to-mp3.js` | Offline meSpeak MP3 generator is a separate product, not part of ECHO. |
| `memory/PRD.md` | Stale; predates the current product and now misleads. |
| `docs/handoff/*.md` | Active codebase should not contain 14 historical handoff files. Archive to `docs/history/` or delete. |
| `.clone-pids`, `.clone-tunnel-url`, `uvicorn.log`, `cloudflared.log` | Operational artifacts from the old backend/clone mixture. |

### Concepts to remove

- **Voice dictation / STT** — out of scope.
- **Silent clone fallback** — clone voices are a provider, not a rescue path.
- **Voice remapping** (`SAMPLE_TO_AURA`, `AURA_TO_SAMPLE`) — a voice has one provider.
- **Provider switchboard** — no `SPEECH_PROVIDER` env var.
- **Manual cache-buster strings** — use Vite content hashes.
- **Cross-repo site sync** — one repo, one deploy for the edge.
- **Mongo as primary storage** — D1 only, scoped to drafts.

### What stays

- `PRODUCT.md` — still defines the product.
- `clone/engine.py` and `clone/voices/` — required for the four custom voices.
- `design_guidelines.json` — can be merged into `ui/src/styles/` later, but keep for reference.
- The public domain; only the origin it points to changes.

---

## E. Complexity Score

Scores are 1–10, where higher is better for the “-ability” columns and worse for Complexity.

| Dimension | Current | Proposed | Rationale |
|-----------|---------|----------|-----------|
| **Complexity** | 9 | 3 | Current has 4 speech authorities, 2 UIs, 2 databases, 3 deploy paths, dictation flow. Proposed has 1 Worker, 1 UI, 1 DB, only TTS. |
| **Maintainability** | 3 | 9 | Current changes must be made in 2–4 places. Proposed change has one obvious owner per responsibility. |
| **Reliability** | 3 | 8 | Current TTS only works because of a hidden clone fallback. Proposed failures are explicit and visible; no STT quota risk. |
| **Testability** | 4 | 9 | Current E2E must cover four speech stacks and two UIs. Proposed modules have isolated inputs/outputs and one E2E surface. |
| **Deployability** | 2 | 8 | Current deploy = build Expo + build hardline + Worker deploy + rsync to second repo + Pages deploy + tunnel secret rotation. Proposed = one edge deploy + documented sidecar restart. |

### Estimated reduction

| Metric | Estimate |
|--------|----------|
| Source files removed | ~65 (backend, frontend, web, old workers, scripts) |
| Source lines removed | ~6,500 |
| Modules merged | 4 speech stacks → 2 explicit providers; 2 UIs → 1; 2 databases → 1 |
| Duplicate logic eliminated | TTS routing (4× → 1×), file parsing (3× → 1×), auth (3× → 1×), voice catalog (3× → 1×) |
| Deploy steps for the edge | 5+ manual/semi-automated steps → 1 command |

---

## Open decisions before implementation

1. **Custom-domain routing**: Whether `martin.govern-ai.ca/echo/` points to the Worker via a custom domain or a route. This does not change the architecture.
2. **Native mobile app**: If a true native app is required, the cheapest path is a WebView wrapper around `ui/`; rebuilding the UI in React Native reintroduces the duplication this design eliminates.
