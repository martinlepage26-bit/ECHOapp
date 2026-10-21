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
- Run: `COQUI_TOS_AGREED=1 PYTORCH_ENABLE_MPS_FALLBACK=1 TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD=1 ~/.local/share/echo-voice/.venv-torch28/bin/python deploy/xtts/server.py`

## Caveats (read before go-live)
- **Licence:** XTTS-v2 weights are under the Coqui Public Model License, which is **non-commercial only**.
  Echo must stay personal / non-commercial while it uses XTTS. Any commercial use needs a different engine.
- **MacBook sleep:** the origin runs on Martin's MacBook Air. When the Mac sleeps, is offline, or the server is not running,
  Echo has no voice and shows "Echo voice unavailable" (by design, no fallback).
- First request after start is slow while the model loads; `/health` reports `ready:false` until then.

## F5-TTS (optional, removable)
`deploy/f5tts/` is kept behind config only (`TTS_ENGINE = "f5"` plus pointing `TTS_UPSTREAM` at an F5 origin on `127.0.0.1:5434`).
It is not the default. Delete `deploy/f5tts/` to remove it; nothing else imports it.

## Rollback point
Worker `echo` current version: `01038eb5-a267-4446-9889-f5f87460e95f` (deployed 2026-10-17).
Rollback: `npx wrangler rollback 01038eb5-a267-4446-9889-f5f87460e95f --name echo`.

## Steps (on the Mac, never on CT920; each needs Martin's OK)
1. `brew install cloudflared && cloudflared tunnel login` (browser sign-in, zone govern-ai.ca).
2. `cloudflared tunnel create echo-tts`; put the UUID in `deploy/xtts/cloudflared-config.yml`, copy to `~/.cloudflared/echo-tts.yml`.
3. Cloudflare Zero Trust > Access > Service auth: create service token `echo-worker-tts` (copy ID/secret once, do not paste in chat).
4. Access > Applications > Self-hosted: `tts.govern-ai.ca`, policy action **Service Auth**, include the token above only. Verify `curl https://tts.govern-ai.ca/health` returns 403 without headers (after step 5).
5. `cloudflared tunnel route dns echo-tts tts.govern-ai.ca`, then `cloudflared tunnel --config ~/.cloudflared/echo-tts.yml run echo-tts`.
6. Load the XTTS server: copy `deploy/xtts/ca.govern-ai.echo-xtts.plist` to `~/Library/LaunchAgents/`, remove its `Disabled` key, then
   `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/ca.govern-ai.echo-xtts.plist`.
7. `npx wrangler secret put CF_ACCESS_CLIENT_ID --name echo` and `npx wrangler secret put CF_ACCESS_CLIENT_SECRET --name echo`.
8. Merge this PR, then `npm run deploy`. Check `https://martin.govern-ai.ca/echo/api/tts/health` -> `{"ready":true}` and play both voices.

## Undo
`wrangler rollback` (above); delete the `tts.govern-ai.ca` DNS record in the dashboard; `cloudflared tunnel delete echo-tts`;
`launchctl bootout gui/$(id -u)/ca.govern-ai.echo-xtts`.
