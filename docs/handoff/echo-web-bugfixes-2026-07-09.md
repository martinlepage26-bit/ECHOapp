## ECHO Web Bug Fixes

- Date: `2026-07-09`
- Branch: `codex/echo-web-bugfixes`
- Commit hashes: none created
- Live URLs: none

### What Is Done

- Fixed browser uploads so the web app sends real `Blob`/`File` payloads instead of React Native `{ uri, name, type }` objects.
- Wired document and audio import flows to pass the picked web `File` when Expo provides it.
- Replaced web readback playback from base64 `data:` URIs with browser-safe blob object URLs.
- Added explicit fallback messaging when a browser blocks autoplay after TTS generation.
- Added object URL cleanup so repeated playback does not leak browser resources.

### Files Changed

- `frontend/src/api.ts`
- `frontend/app/(tabs)/readback.tsx`
- `frontend/app/(tabs)/dictation.tsx`

### Verification Commands And Results

- `python3 -m py_compile /home/martin/apps/web-apps/ECHOapp/backend/server.py`
  - result: passed
- `node -e "const fd=new FormData(); fd.append('audio', new Blob(['abc'], {type:'audio/mpeg'}), 'sample.mp3'); const v=fd.get('audio'); console.log(v instanceof Blob, v.name, v.type, v.size);"`
  - result: `true sample.mp3 audio/mpeg 3`
- `node -e "const u=URL.createObjectURL(new Blob([Buffer.from('abc')],{type:'audio/mpeg'})); console.log(u.startsWith('blob:')); URL.revokeObjectURL(u);"`
  - result: `true`
- `cd /home/martin/apps/web-apps/ECHOapp/frontend && npm run lint`
  - result: blocked, `frontend/node_modules` missing
- `cd /home/martin/apps/web-apps/ECHOapp/frontend && npx tsc --noEmit`
  - result: blocked, `frontend/node_modules` missing

### Risks

- `medium` Frontend lint and TypeScript verification are still blocked until dependencies are installed in `frontend/`.
- `low` Browsers can still deny autoplay after the TTS network round-trip; the app now surfaces that state and lets the next tap start playback explicitly.

### Next Decision

- Install frontend dependencies and run `npm run lint` plus `npx tsc --noEmit`.
- After dependencies exist, run a real browser smoke on:
  1. readback playback in the strictest target browser
  2. document import on web
  3. audio import and recorded dictation upload on web
