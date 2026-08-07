## ECHO Deploy Attempt

- Date: `2026-07-11`
- Commit hashes: none created
- Scope: attempted live deployment of the current ECHO web app

### What Was Checked

- Verified the repo has no checked-in deployment manifest for Sites, Pages, Vercel, Netlify, or Cloudflare.
- Verified the frontend is an Expo web app with static output configured in `frontend/app.json`.
- Verified the historical default backend URL in tests (`https://echo-demo.preview.emergentagent.com`) does not currently serve `/api/voices`.
- Verified a fallback publish path exists on this host via `cloudflared`, but only if the real backend can run locally.

### Verification Commands And Results

- `curl -sS -m 10 https://echo-demo.preview.emergentagent.com/api/voices`
  - result: `404 page not found`
- `python3 - <<'PY' ... print presence of MONGO_URL, DB_NAME, EMERGENT_LLM_KEY ... PY`
  - result:
    - `MONGO_URL=missing`
    - `DB_NAME=missing`
    - `EMERGENT_LLM_KEY=missing`
- `python3 - <<'PY' ... import backend/server.py ... PY`
  - result: `ModuleNotFoundError: No module named 'emergentintegrations'`
- `which cloudflared`
  - result: `/usr/local/bin/cloudflared`

### Blocking Condition

- A real deployment is blocked on backend runtime availability.
- The frontend can be exported statically, but it depends on a live API for voices, TTS, STT, document parsing, drafts, and transcripts.
- This machine currently lacks both:
  - the backend Python dependency surface needed to boot `backend/server.py`
  - the runtime environment variables needed for MongoDB and the TTS/STT provider

### Next Decision

- Provide a real production API base URL for the frontend, or
- provide backend runtime credentials plus dependency installation authority so the backend can be started locally and published through a tunnel or another host.
