#!/usr/bin/env bash
# Start ECHO end-to-end: FastAPI + exported web + optional Cloudflare quick tunnel.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
PORT="${ECHO_PORT:-8099}"
VENV="${BACKEND}/.venv"

if [[ ! -x "$VENV/bin/uvicorn" ]]; then
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install -r "$BACKEND/requirements.txt"
fi

# Free the port if something already owns it (best-effort).
if command -v fuser >/dev/null 2>&1; then
  fuser -k "${PORT}/tcp" 2>/dev/null || true
  sleep 1
fi

# Ensure web build exists (same-origin /api + X-Echo-Key baked in).
if [[ ! -f "$FRONTEND/dist/index.html" ]]; then
  echo "No frontend/dist — exporting web..."
  # shellcheck disable=SC1091
  set -a; source "$BACKEND/.env"; set +a
  (
    cd "$FRONTEND"
    export CI=1 EXPO_PUBLIC_BACKEND_URL="" EXPO_PUBLIC_ECHO_KEY="${ECHO_API_KEY:-}"
    npx expo export --platform web --output-dir dist
  )
fi

cd "$BACKEND"
nohup "$VENV/bin/uvicorn" server:app --host 127.0.0.1 --port "$PORT" --log-level info \
  > uvicorn.log 2>&1 &
echo "API pid $! → http://127.0.0.1:${PORT}/readback"

if [[ "${ECHO_TUNNEL:-0}" == "1" ]] && command -v cloudflared >/dev/null 2>&1; then
  nohup cloudflared tunnel --url "http://127.0.0.1:${PORT}" --no-autoupdate \
    > cloudflared.log 2>&1 &
  echo "Tunnel pid $! — watch cloudflared.log for https://*.trycloudflare.com"
fi

echo "Logs: $BACKEND/uvicorn.log"
