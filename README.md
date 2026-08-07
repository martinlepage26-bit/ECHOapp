# ECHO

Browser-native voice reader: paste or import text, listen with live word tracking, save drafts.

**Canonical tree:** `/home/martin/work/web-apps/ECHOapp`

## Layout

| Path | Role |
|------|------|
| `ui/` | Single web UI (Vite + React) |
| `worker/` | One Cloudflare Worker: static assets, TTS, parse, drafts |
| `clone/` | Local SpeechT5 / OpenVoice sidecar for custom voices |
| `docs/architecture/redesign.md` | Full redesign rationale |

## Quick start

```bash
# Install dependencies
npm install

# Run the clone sidecar (required for echo/patricia/martin-* voices)
cd clone
# see clone/systemd/ for persistent service units
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python3 server.py

# In another terminal, run the Worker + UI
npm run dev
```

## Deploy

```bash
npm run build   # builds ui/dist
npm run deploy  # deploys the Worker with ui/dist assets
```

The clone sidecar is deployed and restarted separately on its host.

## Configuration

| Variable | Where | Purpose |
|----------|-------|---------|
| `ECHO_API_KEY` | Wrangler secret + `.dev.vars` + clone sidecar | Single auth gate |
| `ECHO_CLONE_TTS_URL` | Wrangler secret + `.dev.vars` | Clone sidecar origin |
| `ECHO_TTS_MODEL` | `wrangler.toml` `[vars]` | Workers AI TTS model |

See `.env.example` (root) and `clone/.env.example`.

## Product

See [PRODUCT.md](./PRODUCT.md).
