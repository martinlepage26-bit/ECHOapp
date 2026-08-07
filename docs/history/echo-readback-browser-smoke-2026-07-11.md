## ECHO Readback Browser Smoke

- Date: `2026-07-11`
- Commit hashes: none created
- Live URLs: local Expo web on `http://127.0.0.1:19007`, local mock API on `http://127.0.0.1:8008`

### What Is Done

- Launched the current Expo web app under Node `20.20.2` because the host default Node `18.19.1` cannot run the current Metro stack (`Array.prototype.toReversed` missing).
- Restarted Expo web after the latest `readback.tsx` patch so the served bundle includes the current web replay guard.
- Verified the readback path live in headless Chromium and Firefox against a local mock API that reuses the new backend speech cleanup and timing logic.
- Confirmed that the frontend sends `voice_id: "echo"` by default on the TTS request.
- Confirmed that markdown-heavy input is normalized before speech/readback output, removing `#` headings and list dashes from the spoken text.
- Confirmed that the first web click now only generates audio and shows the `Audio ready. Press PLAY to start readback.` hint instead of collapsing directly into playback.
- Confirmed in Chromium that the second click loads metadata, starts playback, advances elapsed time to clip end, and fires `pause` plus `ended`.
- Confirmed in Firefox that the second click follows the same control flow (`load` -> `loadedmetadata` -> `play`) but the browser emits a media error immediately after playback starts in headless mode.
- Confirmed in Playwright WebKit that the page still crashes on this host after `/api/tts/generate` returns `200`.

### Verification Commands And Results

- `export PATH=/home/martin/.nvm/versions/node/v20.20.2/bin:$PATH && CI=1 EXPO_PUBLIC_BACKEND_URL=http://127.0.0.1:8008 npm run web -- --port 19007`
  - result: Expo web started successfully and served on `http://localhost:19007`
- `python3 - <<'PY' ... HTTPServer(('127.0.0.1', 8008), Handler).serve_forever()`
  - result: local mock API started and logged cleaned TTS requests using `normalize_tts_text` plus `estimate_word_timings`
- `export PATH=/home/martin/.nvm/versions/node/v20.20.2/bin:$PATH && npx tsc --noEmit`
  - result: passed
- `export PATH=/home/martin/.nvm/versions/node/v20.20.2/bin:$PATH && node - <<'JS' ... chromium + firefox smoke ... JS`
  - result: after the fresh bundle load, both Chromium and Firefox showed the expected first-click state:
    - one `POST /api/tts/generate`
    - hint visible: `Audio ready. Press PLAY to start readback.`
    - no playback clock advance on first click
    - readback pane text already cleaned and ready for tracking
- `export PATH=/home/martin/.nvm/versions/node/v20.20.2/bin:$PATH && node - <<'JS' ... chromium + firefox audio instrumentation ... JS`
  - result:
    - Chromium second click: `load` -> `loadedmetadata` -> `play` -> `pause` -> `ended`, with elapsed time reaching `00:01 / 00:01`
    - Firefox second click: `load` -> `loadedmetadata` -> `play` -> `error` -> `pause` -> `ended`, with the same `00:01 / 00:01` end state
- `export PATH=/home/martin/.nvm/versions/node/v20.20.2/bin:$PATH && node - <<'JS' ... webkit smoke ... JS`
  - result: WebKit loaded the app, issued `POST /api/tts/generate`, received `200`, then the page crashed before playback could begin

### Observed Evidence

- Mock API request logs:
  - `{"voice_id":"echo","cleaned_text":"Heading. ... first item. second item. ...","word_count":14}`
- Served Expo bundle includes the new guard logic:
  - `webReplayGuardUntilRef`
  - `if (isWeb && Date.now() < webReplayGuardUntilRef.current)`
  - `webReplayGuardUntilRef.current = Date.now() + 400`
- Chromium runtime observations:
  - first click only generates and shows the hint
  - second click loads the `data:audio/mpeg;base64,...` source
  - playback reaches clip end cleanly
- Firefox runtime observations:
  - first click only generates and shows the same hint
  - second click reaches `play`
  - browser emits a headless media error on the generated `data:` URL after playback starts
- WebKit runtime observations:
  - `/api/tts/generate` request succeeds
  - the page crashes immediately afterward on this host

### Risks

- `high` The goal requirement `the webapp must behave the same on all browser` is still not proven because Playwright WebKit crashes on this host after a successful TTS response, and Firefox headless reports a media error after playback starts.
- `low` The live browser smoke used a local mock API that mirrors the new cleanup/timing logic rather than the real TTS backend, because local backend secrets are not present in the repo or shell environment.

### Next Decision

- If Safari/WebKit parity is required for closeout, reproduce the current bundle in a non-headless Safari/WebKit-capable environment and verify whether the crash is host-specific or an ECHO web-audio defect.
- If Firefox parity is required beyond headless smoke, run the same second-click playback in a headed Firefox session with a real audio sink to determine whether the `NS_ERROR_DOM_MEDIA_MEDIASINK_ERR` is only a headless media-device limitation.
