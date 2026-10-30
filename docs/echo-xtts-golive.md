# Echo voice on XTTS-v2: go-live runbook

(Renamed from `echo-f5tts-golive.md`. Martin chose XTTS-v2 for both voices on 2026-10-21 because F5-TTS garbles French.)

Status: prepared and tested locally only. Nothing below has been run.

## Architecture
Browser -> Worker `echo` (`/echo/api/tts`, body `{text, voice: echo|martin, lang: fr|en}`, defaults `echo`, `fr`)
-> `https://tts.govern-ai.ca` (Cloudflare Access, service-token only)
-> cloudflared named tunnel `echo-tts` on Martin's Mac -> XTTS-v2 API `127.0.0.1:8765` (`deploy/xtts/server.py`).
The Worker sends `{text, voice, engine, lang}` upstream. `TTS_ENGINE` defaults to `xtts`.
The Worker fails closed (503, bilingual message) when secrets are missing, the origin is down,
times out, or returns non-audio. The UI has no browser speech fallback.

## Voices (reference clips, read at server start)
- `echo`: `~/.local/share/echo-voice/reference.wav` (env `ECHO_XTTS_REF_ECHO`)
- `martin`: `~/.local/share/f5tts/voices/martin.wav` (env `ECHO_XTTS_REF_MARTIN`)

## Local API (`deploy/xtts/server.py`, stdlib HTTP, binds 127.0.0.1 only, Host allowlist)
- `GET /health` -> `{"service":"echo-xtts","ready":true,"engine":"xtts","voices":["echo","martin"],"default":"echo"}`
- `POST /tts` `{"text":"...","voice":"echo|martin","engine":"xtts","lang":"fr|en"}` -> `audio/wav` (24 kHz mono PCM16).
  400 on empty/over-600-char text, unknown voice, engine other than `xtts`, or unsupported lang.
- Token: `~/.config/echo-xtts/token` (created locally, chmod 600). Requests need header `X-Echo-Origin-Token`.
- Run: `COQUI_TOS_AGREED=1 PYTORCH_ENABLE_MPS_FALLBACK=1 TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD=1 ~/.local/share/echo-voice/.venv-torch28/bin/python deploy/xtts/server.py`

## Caveats (read before go-live)
- **Licence:** XTTS-v2 weights are under the Coqui Public Model License, which is **non-commercial only**.
  Echo must stay personal / non-commercial while it uses XTTS. Any commercial use needs a different engine.
- **MacBook sleep:** the origin runs on Martin's MacBook Air. When the Mac sleeps, is offline, or the server is not running,
  Echo has no voice and shows "Echo voice unavailable" (by design, no fallback).
- First request after start is slow while the model loads; `/health` reports `ready:false` until then.

## Security (Argus gate 2026-10-21 responses)
- **Viewer gate (M1).** The Worker requires a valid Cloudflare Access JWT (`Cf-Access-Jwt-Assertion`) on `/echo/api/tts` and
  `/echo/api/tts/health`, for both voices: RS256 signature against `https://<ACCESS_TEAM_DOMAIN>/cdn-cgi/access/certs`,
  `aud` in `ACCESS_AUD`, `exp` not passed, `iss` = team domain, `email` in `ACCESS_ALLOWED_EMAILS`.
  No token -> 401; bad signature/expired -> 401; wrong aud or email -> 403; any of the three vars empty -> 403.
- **Rate limit.** Per signed-in email: Workers rate-limiting binding `TTS_RATE_LIMITER` if bound, else a per-isolate
  counter (`TTS_RATE_PER_MIN`, default 30/min) -> 429. Edge backstop (free plan allows one rule): Security > WAF >
  Rate limiting rules: `URI Path starts with "/echo/api/tts"` on `martin.govern-ai.ca`, 10 requests / 10 s per IP, action Block 10 s.
- **Origin auth (M2).** `deploy/xtts/server.py` requires `X-Echo-Origin-Token` matching `~/.config/echo-xtts/token`
  (>=32 chars, chmod 600; or env `ECHO_XTTS_TOKEN`). No token configured -> 503 for everything; wrong/missing -> 403.
  The Host allowlist is kept but is not relied on. The Worker refuses to call the origin without `TTS_ORIGIN_TOKEN`.
- **Busy (S1).** One synthesis at a time plus `ECHO_XTTS_MAX_QUEUE` waiting (default 2); extra requests get 503 at once.
- **F5 (S2).** `deploy/f5tts/` was removed; `TTS_ENGINE` only accepts `xtts`. `build_refs.py` moved to `deploy/xtts/`.

## Rollback point
Worker `echo` current version: `01038eb5-a267-4446-9889-f5f87460e95f` (deployed 2026-10-17).
Rollback: `npx wrangler rollback 01038eb5-a267-4446-9889-f5f87460e95f --name echo`.

## What Martin configures in Cloudflare (Zero Trust, free plan)
- Team name: Zero Trust > Settings > Custom Pages / team domain -> `<team>.cloudflareaccess.com` => `ACCESS_TEAM_DOMAIN`.
- Access app A (viewer): Self-hosted, domain `martin.govern-ai.ca`, path `echo` (covers `/echo/*`, so the page itself logs in
  and API calls carry the JWT). Policy Allow, include Emails = Martin's sign-in email. Copy its **AUD tag** => `ACCESS_AUD`.
  Put the same email(s) in `ACCESS_ALLOWED_EMAILS`.
- Access app B (origin): Self-hosted `tts.govern-ai.ca`, policy action **Service Auth**, include only service token `echo-worker-tts`.

## Pre-deploy checks (must pass before `npm run deploy`)
1. `curl -s -o /dev/null -w '%{http_code}\n' https://tts.govern-ai.ca/health` (no headers) -> `403`.
2. Same with only the service-token headers (no origin token) -> `403` from the origin.
3. Locally: `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8765/health` -> `403`.
4. After deploy: `curl -s -o /dev/null -w '%{http_code}\n' -X POST https://martin.govern-ai.ca/echo/api/tts -d '{"text":"x","voice":"martin"}'`
   -> `302`/`401`/`403` (Access login), never audio.

## Steps (on the Mac, never on CT920; each needs Martin's OK)
1. `brew install cloudflared && cloudflared tunnel login` (browser sign-in, zone govern-ai.ca).
2. `cloudflared tunnel create echo-tts`; put the UUID in `deploy/xtts/cloudflared-config.yml`, copy to `~/.cloudflared/echo-tts.yml`.
3. Cloudflare Zero Trust > Access > Service auth: create service token `echo-worker-tts` (copy ID/secret once, do not paste in chat).
4. Access > Applications > Self-hosted: `tts.govern-ai.ca`, policy action **Service Auth**, include the token above only. Verify `curl https://tts.govern-ai.ca/health` returns 403 without headers (after step 5).
5. `cloudflared tunnel route dns echo-tts tts.govern-ai.ca`, then `cloudflared tunnel --config ~/.cloudflared/echo-tts.yml run echo-tts`.
6. Load the XTTS server: copy `deploy/xtts/ca.govern-ai.echo-xtts.plist` to `~/Library/LaunchAgents/`, remove its `Disabled` key, then
   `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/ca.govern-ai.echo-xtts.plist`.
7. `npx wrangler secret put CF_ACCESS_CLIENT_ID --name echo`, `... CF_ACCESS_CLIENT_SECRET ...`, and
   `... TTS_ORIGIN_TOKEN ...` (paste the contents of `~/.config/echo-xtts/token`; never in chat). Fill the three `ACCESS_*` vars in `wrangler.toml`.
8. Merge this PR, then `npm run deploy`. Check `https://martin.govern-ai.ca/echo/api/tts/health` -> `{"ready":true}` and play both voices.

## Undo
`wrangler rollback` (above); delete the `tts.govern-ai.ca` DNS record in the dashboard; `cloudflared tunnel delete echo-tts`;
`launchctl bootout gui/$(id -u)/ca.govern-ai.echo-xtts`.

## Secret writes and plain vars (diagnosis 2026-10-21)
- Argus saw the live version `2cb8f5c7` with no plain vars (`TTS_UPSTREAM`, `ACCESS_*`). Nothing was stripped.
  Version `01038eb5` (2026-10-17, built from main before PR #3) never had a `[vars]` block. Every secret write
  (`1c00e3f5` and `f3aa5573` by API, `2cb8f5c7` by `wrangler secret put`) copied the live version's bindings and
  added one secret. The vars first appear when the new code is deployed with `npm run deploy`, which reads `wrangler.toml`.
- Each secret write deploys a new live version straight away, one version per secret.
- Rules for future writes:
  1. Prefer `npx wrangler secret put NAME --name echo < file` on the Mac. It keeps the existing bindings.
  2. If you use the API, use `PUT /accounts/{id}/workers/scripts/echo/secrets`. It keeps the other bindings.
     Never re-upload the script or settings with a partial `bindings` list; that drops vars and assets.
  3. To change secrets without going live, use `npx wrangler versions secret put NAME --name echo`, then deploy the version.
  4. After any write, list binding names, never values, for example with `GET .../workers/scripts/echo/versions/{id}`. Check that `ASSETS` and the expected vars are present.
