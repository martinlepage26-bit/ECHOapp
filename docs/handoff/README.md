# ECHO handoff index

Tags: `current` (accurate today) · `reference` (historical, not contradicted) · `superseded` (see replacement).

| File | Status | Reason |
|---|---|---|
| echo-browser-assessment-2026-07-09.md | superseded | Diagnosis fully actioned same day by echo-web-bugfixes-2026-07-09.md; no standalone value left. |
| echo-web-bugfixes-2026-07-09.md | superseded | Blob/File-upload fix still holds, but its base64-data-URI→blob-URL playback approach was replaced by the native `<audio>` element in echo-natural-readback-2026-07-11.md. |
| echo-deploy-attempt-2026-07-11.md | superseded | Explicitly corrected by echo-provider-decouple-2026-07-11.md ("Corrections To The Prior Record"): MongoDB was in fact running, only `emergentintegrations` was missing. |
| echo-natural-readback-2026-07-11.md | reference | speech_text.py normalization and native-audio playback it introduced are explicitly preserved untouched by the following session; still describes present-day behavior. |
| echo-provider-decouple-2026-07-11.md | reference | Foundational architecture doc — provider abstraction, Piper default, lazy Mongo still match backend/speech_providers.py. Only its "Live Deploy" cloudflared-tunnel URL is stale, superseded by echo-workers-ai-2026-08-01.md's live deploy. |
| echo-readback-browser-smoke-2026-07-11.md | superseded | Manual/mock-API browser smoke superseded by the automated Playwright suite added in echoapp-readback-alignment-2026-07-13.md (frontend/tests/readback-web.spec.ts, still in repo). |
| echoapp-readback-alignment-2026-07-13.md | reference | Describes frontend/tests/readback-web.spec.ts, which is the current frontend test asset (confirmed present). |
| echo-workers-ai-2026-08-01.md | current | Most recent; matches the live Workers AI architecture confirmed this session. |

No file is moved or deleted; this index is advisory only.
