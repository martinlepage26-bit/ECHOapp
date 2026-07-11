## ECHO Natural Readback Pass

- Date: `2026-07-11`
- Commit hashes: none created
- Live URLs: none

### What Is Done

- Switched the backend TTS default and invalid-voice fallback to `echo` so the app centers the smoother Echo voice instead of defaulting to Alloy.
- Added backend speech-text normalization that strips markdown headings, list markers, separator rules, and inline formatting before text is sent to TTS.
- Replaced the web readback path with a browser-native audio element that primes playback, uses blob URLs, and tracks the real playback clock.
- Rescaled highlight timings against actual audio duration so live highlighting stays closer to the spoken pace.
- Added a local `PRODUCT.md` so the frontend skill has project context rooted in the current app and user goal.
- Added focused backend unit tests for speech-text cleanup and monotonic timing output.

### Files Changed

- `PRODUCT.md`
- `backend/server.py`
- `backend/speech_text.py`
- `backend/tests/test_speech_text.py`
- `backend/tests/test_echo_api.py`
- `frontend/app/(tabs)/readback.tsx`

### Verification Commands And Results

- `cd /home/martin/apps/web-apps/ECHOapp/backend && python3 -m pytest tests/test_speech_text.py`
  - result: passed (`2 passed`)
- `cd /home/martin/apps/web-apps/ECHOapp/backend && python3 -m py_compile server.py speech_text.py`
  - result: passed
- `cd /home/martin/apps/web-apps/ECHOapp/frontend && npm install --package-lock=false`
  - result: passed with Node engine warnings and npm audit warnings; dependencies installed locally without writing a lockfile
- `cd /home/martin/apps/web-apps/ECHOapp/frontend && npx tsc --noEmit`
  - result: passed after updating `useAudioPlayer` to the current options shape
- `cd /home/martin/apps/web-apps/ECHOapp/frontend && npm run lint`
  - result: passed with warnings only; warnings are pre-existing in `app/(tabs)/dictation.tsx` and `app/(tabs)/library.tsx`
- `cd /home/martin/apps/web-apps/ECHOapp && git diff --check`
  - result: passed
- `cd /home/martin/apps/web-apps/ECHOapp/backend && python3 - <<'PY' ...`
  - result: normalized sample `# Heading` plus bullet lines into `Heading.` and plain spoken list text

### Risks

- `medium` I did not run a live browser smoke in Chrome/Safari/Firefox, so the cross-browser playback claim is improved by implementation and static checks but not yet proven end-to-end in real browsers.
- `medium` `npm install` surfaced Node engine mismatch warnings because this host is on Node `18.19.1` while parts of Expo/React Native expect Node `20.19.4+`. TypeScript still passed, but runtime tooling may remain sensitive until Node is upgraded.
- `low` Existing lint warnings outside the readback surface remain in the repo and were not part of this request.

### Next Decision

- Run a manual browser smoke on the deployed or local web surface in at least Chrome and Firefox, with one markdown-heavy draft, one plain-text draft, and one end-to-end play/pause/replay cycle.
- If Safari is a target browser, verify that the web-audio priming path unlocks playback after the first tap there as well.
