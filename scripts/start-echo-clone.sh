#!/usr/bin/env bash
# Start SpeechT5 clone API (from backend/voices/*.mp3) + Cloudflare quick tunnel,
# and point martin-lepage-site Pages secret ECHO_CLONE_TTS_URL at it.
#
# Echo / Patricia / Martin profiles then synthesize ANY draft text in the sample
# speaker colour via https://martin.govern-ai.ca/api/echo-tts
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND="$ROOT/backend"
PORT="${ECHO_PORT:-8099}"
ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-1713c51cc6fbcf8d7143526b93495b76}"
export CLOUDFLARE_ACCOUNT_ID="$ACCOUNT_ID"

if [[ ! -x "$BACKEND/.venv/bin/uvicorn" ]]; then
  echo "Missing backend venv — create it and install requirements first."
  exit 1
fi
if [[ ! -f "$BACKEND/voices/echo.mp3" ]]; then
  echo "Missing $BACKEND/voices/echo.mp3"
  exit 1
fi

# shellcheck disable=SC1091
set -a
source "$BACKEND/.env"
set +a
if [[ -z "${ECHO_API_KEY:-}" ]]; then
  echo "ECHO_API_KEY missing in backend/.env"
  exit 1
fi

if command -v fuser >/dev/null 2>&1; then
  fuser -k "${PORT}/tcp" 2>/dev/null || true
  sleep 1
fi

cd "$BACKEND"
nohup .venv/bin/uvicorn server:app --host 127.0.0.1 --port "$PORT" --log-level info \
  >uvicorn.log 2>&1 &
API_PID=$!
echo "API pid=$API_PID → http://127.0.0.1:${PORT}"

for i in $(seq 1 40); do
  if curl -sf "http://127.0.0.1:${PORT}/api/" >/dev/null; then
    break
  fi
  sleep 1
  if ! kill -0 "$API_PID" 2>/dev/null; then
    echo "API failed:"; tail -30 uvicorn.log; exit 1
  fi
done

nohup cloudflared tunnel --url "http://127.0.0.1:${PORT}" --no-autoupdate \
  >cloudflared.log 2>&1 &
TUN_PID=$!
echo "tunnel pid=$TUN_PID"

TUNNEL_URL=""
for i in $(seq 1 45); do
  TUNNEL_URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' cloudflared.log | tail -1 || true)
  [[ -n "$TUNNEL_URL" ]] && break
  sleep 1
done
if [[ -z "$TUNNEL_URL" ]]; then
  echo "Tunnel URL not found:"; tail -40 cloudflared.log; exit 1
fi

echo "$TUNNEL_URL" >"$BACKEND/.clone-tunnel-url"
echo "API_PID=$API_PID TUN_PID=$TUN_PID" >"$BACKEND/.clone-pids"
echo "tunnel host: ${TUNNEL_URL#https://}"

# Keep Pages + Worker secrets aligned with this backend (no values printed).
# Worker clone fallback is what keeps Expo / Aura ids alive when Workers AI neurons are out.
export CLOUDFLARE_ACCOUNT_ID="$ACCOUNT_ID"
unset CLOUDFLARE_API_TOKEN || true
printf '%s' "$TUNNEL_URL" | npx wrangler pages secret put ECHO_CLONE_TTS_URL \
  --project-name martin-lepage-site >/dev/null
printf '%s' "$ECHO_API_KEY" | npx wrangler pages secret put ECHO_API_KEY \
  --project-name martin-lepage-site >/dev/null
printf '%s' "$TUNNEL_URL" | npx wrangler secret put ECHO_CLONE_TTS_URL \
  --config "$ROOT/workers/echo-ai/wrangler.toml" >/dev/null
printf '%s' "$ECHO_API_KEY" | npx wrangler secret put ECHO_API_KEY \
  --config "$ROOT/workers/echo-ai/wrangler.toml" >/dev/null

# Pre-warm SpeechT5 + echo embedding
curl -sS -X POST "http://127.0.0.1:${PORT}/api/tts/raw" \
  -H "Content-Type: application/json" \
  -H "X-Echo-Key: ${ECHO_API_KEY}" \
  -d '{"text":"Warm.","voice_id":"echo","speed":1}' \
  -o /dev/null -w "warm local %{http_code}\n" --max-time 180

echo "Clone ready. Live path: POST https://martin.govern-ai.ca/api/echo-tts voice_id=echo"
echo "Worker fallback secret ECHO_CLONE_TTS_URL also refreshed on echo-ai."
echo "Logs: $BACKEND/uvicorn.log  $BACKEND/cloudflared.log"
