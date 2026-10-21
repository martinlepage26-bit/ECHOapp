# Echo voice on F5-TTS: go-live runbook

Status: prepared and tested locally only. Nothing below has been run.

## Architecture
Browser -> Worker `echo` (`/echo/api/tts`, voices `echo` | `martin`, default `echo`)
-> `https://f5tts.govern-ai.ca` (Cloudflare Access, service-token only)
-> cloudflared named tunnel `echo-f5` on Martin's Mac -> F5-TTS API `127.0.0.1:5434`.
The Worker fails closed (503, bilingual message) when secrets are missing, the origin is down,
times out, or returns non-audio. The UI has no browser speech fallback.

## Rollback point
Worker `echo` current version: `01038eb5-a267-4446-9889-f5f87460e95f` (deployed 2026-10-17).
Rollback: `npx wrangler rollback 01038eb5-a267-4446-9889-f5f87460e95f --name echo`.

## Steps (on the Mac, never on CT920)
1. `brew install cloudflared && cloudflared tunnel login` (browser sign-in, zone govern-ai.ca).
2. `cloudflared tunnel create echo-f5`; put the UUID in `deploy/f5tts/cloudflared-config.yml`, copy to `~/.cloudflared/echo-f5.yml`.
3. Cloudflare Zero Trust > Access > Service auth: create service token `echo-worker-f5tts` (copy ID/secret once, do not paste in chat).
4. Access > Applications > Self-hosted: `f5tts.govern-ai.ca`, policy action **Service Auth**, include the token above only. Verify `curl https://f5tts.govern-ai.ca/health` returns 403 without headers (after step 5).
5. `cloudflared tunnel route dns echo-f5 f5tts.govern-ai.ca`, then `cloudflared tunnel --config ~/.cloudflared/echo-f5.yml run echo-f5` (or install as a LaunchAgent).
6. Load the F5 server: `launchctl enable gui/$(id -u)/ca.govern-ai.echo-f5tts && launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/ca.govern-ai.echo-f5tts.plist`.
7. `npx wrangler secret put CF_ACCESS_CLIENT_ID --name echo` and `npx wrangler secret put CF_ACCESS_CLIENT_SECRET --name echo`.
8. Merge this PR, then `npm run deploy`. Check `https://martin.govern-ai.ca/echo/api/tts/health` -> `{"ready":true}` and play both voices.

## Undo
`wrangler rollback` (above); `cloudflared tunnel route dns` record delete in the dashboard; `cloudflared tunnel delete echo-f5`;
`launchctl bootout gui/$(id -u)/ca.govern-ai.echo-f5tts`.
