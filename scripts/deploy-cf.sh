#!/usr/bin/env bash
# Build Expo web + deploy full ECHO stack to Cloudflare Workers (UI + /api speech).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
WORKER="$ROOT/workers/echo-ai"
ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-1713c51cc6fbcf8d7143526b93495b76}"

# shellcheck disable=SC1091
if [[ -f "$BACKEND/.env" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$BACKEND/.env"
  set +a
fi

if [[ -z "${ECHO_API_KEY:-}" ]]; then
  echo "ECHO_API_KEY missing in backend/.env — aborting (needed in web bundle + Worker secret)."
  exit 1
fi

echo "==> Export Expo web (same-origin /api, key baked in)"
(
  cd "$FRONTEND"
  export CI=1
  export EXPO_PUBLIC_BACKEND_URL=""
  export EXPO_PUBLIC_ECHO_KEY="$ECHO_API_KEY"
  if [[ ! -d node_modules/expo ]]; then
    yarn install --frozen-lockfile
  fi
  npx expo export --platform web --output-dir dist
  # Workers 404-page expects 404.html; Expo emits +not-found.html
  if [[ -f dist/+not-found.html && ! -f dist/404.html ]]; then
    cp dist/+not-found.html dist/404.html
  fi
)

echo "==> Deploy Worker + static assets (account $ACCOUNT_ID)"
(
  cd "$WORKER"
  export CLOUDFLARE_ACCOUNT_ID="$ACCOUNT_ID"
  if [[ ! -d node_modules/wrangler ]]; then
    npm install --no-fund --no-audit
  fi
  # Keep Worker secret in sync with local key used in the bundle
  printf '%s' "$ECHO_API_KEY" | npx wrangler secret put ECHO_API_KEY
  npx wrangler deploy
)

echo
echo "Live:"
echo "  https://echo-ai.martinlepage26.workers.dev/readback"
echo "  https://echo-ai.martinlepage26.workers.dev/api/"
echo "Done."
