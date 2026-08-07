## ECHO Browser Behavior Assessment

- Date: `2026-07-09T10:35:20Z`
- Scope: assess why the ECHO web app behaves differently across browsers
- Commit hashes: none created

### What Is Done

- Reviewed the ECHO frontend and backend upload and playback paths.
- Verified that web upload code uses React Native file-object semantics inside browser `FormData`.
- Verified that the readback path generates a base64 data URI and starts playback after an async delay.
- Cross-checked browser and Expo behavior against primary documentation.

### Key Findings

1. `verified` Web upload handling is structurally wrong in the browser.
   - `frontend/src/api.ts:65-68` appends `{ uri, name, type }` to `FormData` for audio uploads.
   - `frontend/src/api.ts:95-98` does the same for document uploads.
   - MDN states `FormData.append()` accepts a string or `Blob`/`File`; non-matching values are converted to strings.
   - Local reproduction converted the object to the string `[object Object]`, which means browsers do not receive a real file payload from this code path.

2. `verified` The readback path relies on browser-sensitive autoplay behavior.
   - `frontend/app/(tabs)/readback.tsx:242-254` waits for TTS, sets `audioUri`, then calls `player.play()` inside `setTimeout`.
   - MDN states autoplay policies also apply to script-initiated `play()` calls and can reject playback with `NotAllowedError`.
   - This means some browsers will allow the post-request play attempt and others will block or delay it.

3. `claimed` Expo has a known issue with base64 data URIs in `expo-audio`.
   - Official Expo issue `expo/expo#37018` reports that `useAudioPlayer("data:audio/...;base64,...")` can fail because the underlying resolver does not handle data URIs consistently.
   - ECHO uses exactly that pattern at `frontend/app/(tabs)/readback.tsx:246`.

4. `inferred` The first-play timing is fragile even apart from policy differences.
   - The code sets state, then tries to play 120 ms later through a hook-managed player instance.
   - There is no explicit success/failure handling on `player.play()`, so timing-sensitive failures can present as silent no-ops.

### Verification Commands And Results

- `find /home/martin -maxdepth 3 -iname '*echo*'`
  - result: identified `/home/martin/apps/web-apps/ECHOapp`
- `rg -n "browser|userAgent|Safari|Firefox|Chrome|webkit|moz|Edge|MediaRecorder|speech|audio|video|localStorage|IndexedDB|serviceWorker" /home/martin/apps/web-apps/ECHOapp/frontend /home/martin/apps/web-apps/ECHOapp/backend`
  - result: isolated audio, upload, and playback hotspots
- `nl -ba /home/martin/apps/web-apps/ECHOapp/frontend/src/api.ts | sed -n '1,220p'`
  - result: confirmed `FormData.append()` uses `{ uri, name, type }`
- `nl -ba /home/martin/apps/web-apps/ECHOapp/frontend/app/'(tabs)'/readback.tsx | sed -n '219,260p'`
  - result: confirmed base64 data URI playback and delayed `player.play()`
- `node -e "const fd=new FormData(); fd.append('audio',{uri:'file:///tmp/x.m4a',name:'x.m4a',type:'audio/m4a'}); const v=fd.get('audio'); console.log(typeof v, Object.prototype.toString.call(v), String(v));"`
  - result: `string [object String] [object Object]`
- `python3 -m py_compile /home/martin/apps/web-apps/ECHOapp/backend/server.py`
  - result: passed

### Risks

- `high` Browser uploads for dictation import and file import are not reliable on web until the code uses actual `File`/`Blob` objects.
- `high` Readback autoplay can remain inconsistent until playback is attached to a browser-safe user activation path and failure states are handled visibly.
- `medium` Base64 audio URIs may remain brittle in `expo-audio`; a blob URL or fetched file URL is safer.

### Next Decision

- Decide whether to do an assessment-only pass or a repair pass.
- Repair pass should:
  1. branch web upload code to use `DocumentPickerAsset.file` or `output` on web
  2. change readback from base64 data URI playback to `Blob`/object URL playback
  3. make `player.play()` failure explicit and require a second user tap when autoplay is denied
