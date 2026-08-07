# ECHOapp Readback Alignment - 2026-07-13

## Scope

- Repo: `/home/martin/apps/web-apps/ECHOapp`
- This turn aligned the named `ECHOapp` repo with the already-verified hosted ECHO behavior on the live Martin `/echo/` route and added repo-local browser proof for the exported web app itself.
- No commit was created.

## What Changed

- Updated `frontend/app/(tabs)/readback.tsx` so the app prefers the `echo` voice when it is present in the voice catalog, instead of blindly accepting any provider default.
- Updated playback completion behavior on both web and native paths so the final highlighted word remains active at the end of playback instead of clearing immediately.
- Removed the web replay timing gate that could swallow the immediate second Play click after TTS generation.
- Changed web highlight activation so the first word does not light up before playback actually starts.
- Added a Playwright browser test for the exported Expo web surface that verifies:
  - `echo` is chosen even when the backend reports a different default voice
  - markdown hashes and list dashes are cleaned before readback
  - the highlight advances during playback
  - the final word remains highlighted on completion
- Added a tiny repo-local static server for exported Expo files so Playwright can exercise clean routes like `/readback` instead of hydrating on `/readback.html` and falling into Expo Router unmatched-route behavior.

## Files Changed

- `frontend/app/(tabs)/readback.tsx`
- `frontend/package.json`
- `frontend/tsconfig.json`
- `frontend/playwright.config.ts`
- `frontend/scripts/serve-export.mjs`
- `frontend/tests/readback-web.spec.ts`
- `frontend/yarn.lock`

## Verification

- `python3 -m pytest backend/tests/test_speech_text.py backend/tests/test_server_tts_unit.py`
  - passed
  - 7 tests passed
  - covers markdown cleanup, timing estimation, provider-default fallback behavior, and timing scaling
- `python3 -m py_compile backend/server.py backend/speech_text.py backend/speech_providers.py`
  - passed
- `npm run lint`
  - passed with warnings only
  - warnings were in `dictation.tsx` and `library.tsx`, not in `readback.tsx`
- `npx tsc --noEmit`
  - passed
- `PATH=/home/martin/.nvm/versions/node/v22.12.0/bin:$PATH npx playwright test tests/readback-web.spec.ts --config=playwright.config.ts --browser=chromium`
  - passed
- `PATH=/home/martin/.nvm/versions/node/v22.12.0/bin:$PATH npx playwright test tests/readback-web.spec.ts --config=playwright.config.ts --browser=all`
  - passed
  - chromium, firefox, and webkit all passed the same exported-web readback check
- `PATH=/home/martin/.nvm/versions/node/v22.12.0/bin:$PATH npm run web:e2e`
  - passed
  - runs `web:export` followed by the cross-browser Playwright suite

## Evidence Boundary

- Verified:
  - backend cleanup logic strips headings and list markers before TTS
  - backend timing logic is exercised by tests
  - frontend now prefers `echo` when the catalog exposes it
  - frontend no longer pre-highlights the first word before playback starts
  - frontend no longer relies on the removed web replay delay before the second Play click
  - frontend now preserves the last highlighted word on playback completion
  - exported Expo web readback passes the same deterministic interaction check in Chromium, Firefox, and WebKit
- Not verified:
  - human listen-through of the `ECHOapp` frontend itself

## Risks / Remaining Gaps

- Naturalness of the chosen voice is still indirectly supported by provider choice and the removal of system speech synthesis, not by a human acceptance pass recorded in this repo.
- Required rook startup files under `/root/.codex/rook_arrival/` were not readable from this account, so that bootstrap evidence could not be collected.
- Hosted Blackboard closeout scope is still not discoverable for this thread on this machine:
  - `tenant_id` is available
  - `workspace_id` and `project_id` are missing from `if-cli blackboard api whoami`
  - `if-cli blackboard api closeout-report ...` could not be run without inventing scope values

## Next Decision

- Decide whether to add a manual human listen-through checklist for ECHO voice acceptance, or to continue treating hosted-voice selection plus deterministic browser/runtime tests as the proof surface for readback quality.
