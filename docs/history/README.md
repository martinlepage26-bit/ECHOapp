# ECHO handoff index

Tags: `current` (accurate today) · `reference` (historical, not contradicted) · `superseded` (see replacement).

**Start here:** `echo-consolidated-state-2026-08-07.md` — full state, verified live, plus the honest "why is this so complicated" answer. Everything below is primary-source detail it was built from.

| File | Status | Reason |
|---|---|---|
| echo-consolidated-state-2026-08-07.md | current | Consolidated state across all subsystems (TTS/STT/Library/parse-file/browser-delivery/repo drift), verified fresh by 8 independent live checks. Found STT down (4006, no fallback), TTS voice selection non-functional (100% clone fallback, Workers AI serving 0 requests), and a hardline-site stale-cache bug. Supersedes the "verified live" claims in echo-durable-speech-repair-2026-08-07.md and echo-clone-tunnel-hardening-2026-08-07.md, which were true but narrow. |
| echo-browser-assessment-2026-07-09.md | superseded | Diagnosis fully actioned same day by echo-web-bugfixes-2026-07-09.md; no standalone value left. |
| echo-web-bugfixes-2026-07-09.md | superseded | Blob/File-upload fix still holds, but its base64-data-URI→blob-URL playback approach was replaced by the native `<audio>` element in echo-natural-readback-2026-07-11.md. |
| echo-deploy-attempt-2026-07-11.md | superseded | Explicitly corrected by echo-provider-decouple-2026-07-11.md ("Corrections To The Prior Record"): MongoDB was in fact running, only `emergentintegrations` was missing. |
| echo-natural-readback-2026-07-11.md | reference | speech_text.py normalization and native-audio playback it introduced are explicitly preserved untouched by the following session; still describes present-day behavior. |
| echo-provider-decouple-2026-07-11.md | reference | Foundational architecture doc — provider abstraction, Piper default, lazy Mongo still match backend/speech_providers.py. Only its "Live Deploy" cloudflared-tunnel URL is stale, superseded by echo-workers-ai-2026-08-01.md's live deploy. |
| echo-readback-browser-smoke-2026-07-11.md | superseded | Manual/mock-API browser smoke superseded by the automated Playwright suite added in echoapp-readback-alignment-2026-07-13.md (frontend/tests/readback-web.spec.ts, still in repo). |
| echoapp-readback-alignment-2026-07-13.md | reference | Describes frontend/tests/readback-web.spec.ts, which is the current frontend test asset (confirmed present). |
| echo-workers-ai-2026-08-01.md | reference | Workers AI wiring; first recorded free-neuron 4006. Superseded for production durability by echo-durable-speech-repair-2026-08-07.md. |
| echo-merge-webapp-2026-08-06.md | reference | Canonical tree under web-apps/ECHOapp; hardline on martin.govern-ai.ca/echo. |
| echo-durable-speech-repair-2026-08-07.md | reference | Permanent repair: Worker + Pages clone fallback when Workers AI neurons are out; no bare-502 error strip. Tunnel-fragility residual risk it flagged is closed by the next row. Its "verified live" TTS table is accurate but narrow — see consolidated doc above for what it missed (STT, voice selection). |
| echo-clone-tunnel-hardening-2026-08-07.md | reference | Named Cloudflare Tunnel + systemd `--user` units + linger for the clone origin, replacing the ephemeral `trycloudflare.com` quick tunnel; permanent `ECHO_CLONE_TTS_URL`. Superseded as the "current" pointer by the consolidated doc above. |

No file is moved or deleted; this index is advisory only.
