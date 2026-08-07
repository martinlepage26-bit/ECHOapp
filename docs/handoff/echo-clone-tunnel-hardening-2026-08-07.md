# ECHO clone tunnel hardening — 2026-08-07

## Request

Follow-up to the same-day durable-speech repair: address the residual risk
flagged there — the SpeechT5 clone origin ran on an ephemeral
`trycloudflare.com` quick tunnel that dies on process/host restart, with no
systemd or reboot survival.

## What shipped

| Layer | Change |
|-------|--------|
| Cloudflare Tunnel | New **named** tunnel `echo-clone-api` (id `6195f499-ad2d-4e07-8d30-bf07a7767b86`), replacing the ephemeral quick tunnel |
| DNS | `echo-clone-api.pharos-ai.ca` CNAME routed to the tunnel |
| `~/.cloudflared/echo-clone-config.yml` | Ingress config: hostname → `http://127.0.0.1:8099` |
| systemd --user | `echo-clone-backend.service` (uvicorn on :8099) and `echo-clone-tunnel.service` (cloudflared, `Requires=`/`After=` the backend); both `Restart=on-failure`, `WantedBy=default.target` |
| `loginctl enable-linger martin` | Set — user units now start at boot without an interactive login session |
| Worker secret | `ECHO_CLONE_TTS_URL` on `echo-ai` set to the permanent hostname (was the ephemeral tunnel URL) |
| Pages secret | Same on `martin-lepage-site` |
| `ARCHITECTURE.md` | "Clone origin durability" section added; tunnel item removed from non-goals |
| `scripts/start-echo-clone.sh` | Header marks it superseded for normal operation; kept only as an ad hoc/debug fallback |

## Why systemd `--user` and not a system-level (`/etc/systemd/system`) unit

This host (CT920, `workspace-mtl00`) is shared between two users under a
documented system-management policy
(`/srv/workspaces/shared/docs/infrastructure/mtl-00-agent-system-management-policy.md`).
Root-level system units and host/network changes are gated behind that
policy's core-system engagement rule (hosted Blackboard task, live Rook
`PASS`, the operator's dedicated `mtl-00-pve` root route). This session had no
passwordless sudo and the change is squarely application/agent tooling on
CT920 — exactly what the policy says belongs there rather than on the
Proxmox host — so a user-level systemd unit plus `enable-linger` was the
correct-scope tool: full reboot survival, zero root/core-system engagement.

## Verified live (this session)

| Path | Voice | Result |
|------|-------|--------|
| `https://echo-clone-api.pharos-ai.ca/api/` | — | 200, `{"service":"echo","status":"online"}` |
| `POST https://martin.govern-ai.ca/api/echo-tts` | `echo` (sample→clone) | 200, 74796-byte WAV |
| `POST https://martin.govern-ai.ca/api/echo-tts` | `athena` (Worker/Aura→clone map) | 200, 77868-byte WAV |
| `POST https://echo-ai.martinlepage26.workers.dev/api/tts/generate` | `echo` (Expo UI path, direct Worker + API key) | 200, JSON `audio_base64` payload |

Old ad hoc processes (nohup'd uvicorn + quick-tunnel `cloudflared`, running
since 2026-08-06) were killed before handing the port to systemd; confirmed
port 8099 free before the new unit bound it.

## Residual risk (honest, not hidden)

| Risk | Status |
|------|--------|
| Ephemeral tunnel dies on reboot | **Resolved** — named tunnel + systemd + linger |
| Clone process dies on host, no auto-restart | **Resolved** — `Restart=on-failure` on both units |
| Free Workers AI 4006 daily neuron exhaustion | Unchanged from 2026-08-07 repair — clone fallback absorbs it |
| No rate-limiting on the Workers deploy | Still open, unchanged |
| `memory/PRD.md` inside ECHOapp still describes the retired stack | Still open, unchanged |
| cloudflared binary is one minor version behind (2026.7.2 vs 2026.7.3) | Cosmetic, not urgent |

## Operator commands

```bash
# Status
systemctl --user status echo-clone-backend.service echo-clone-tunnel.service

# Manual restart (both units)
systemctl --user restart echo-clone-backend.service echo-clone-tunnel.service

# Logs
journalctl --user -u echo-clone-backend.service -f
journalctl --user -u echo-clone-tunnel.service -f

# If the permanent secrets ever need re-syncing (should not be needed in normal operation)
cd /home/martin/work/web-apps/ECHOapp
printf '%s' "https://echo-clone-api.pharos-ai.ca" | npx wrangler pages secret put ECHO_CLONE_TTS_URL --project-name martin-lepage-site
printf '%s' "https://echo-clone-api.pharos-ai.ca" | npx wrangler secret put ECHO_CLONE_TTS_URL --config workers/echo-ai/wrangler.toml
```

## Acceptance (met)

- [x] Named tunnel + DNS route, replacing the ephemeral quick tunnel
- [x] Backend and tunnel both under systemd `--user`, `Restart=on-failure`
- [x] `enable-linger` set — survives reboot without login
- [x] Worker + Pages secrets point at the permanent hostname
- [x] All three production TTS paths verified live post-change
- [x] Docs (`ARCHITECTURE.md`, `start-echo-clone.sh` header, this handoff) updated same session
