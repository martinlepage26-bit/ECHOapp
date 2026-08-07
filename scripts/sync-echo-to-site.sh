#!/usr/bin/env bash
# Build canonical ECHO web surface and sync into the Martin site tree for Pages deploy.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB="$ROOT/web"
SITE="${ECHO_SITE_ROOT:-$(cd "$ROOT/../../martinlepage26-bit.github.io" 2>/dev/null && pwd || true)}"
ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-1713c51cc6fbcf8d7143526b93495b76}"

if [[ -z "${SITE:-}" || ! -d "$SITE" ]]; then
  echo "Site root not found. Set ECHO_SITE_ROOT to martinlepage26-bit.github.io"
  exit 1
fi

echo "==> Build ECHO web (canonical hardline surface)"
(
  cd "$WEB"
  if [[ ! -d node_modules/vite ]]; then
    npm install --no-fund --no-audit
  fi
  npm run build
)

echo "==> Sync dist → site public/echo + dist/echo"
mkdir -p "$SITE/public/echo" "$SITE/dist/echo"
rsync -a --delete \
  --exclude '.git' \
  "$WEB/dist/echo/" "$SITE/public/echo/"
rsync -a --delete \
  "$WEB/dist/echo/" "$SITE/dist/echo/"

# Keep Pages Function proxies in the site (must live in the Pages project).
# Canonical copies also live under web/pages-functions for reference.
for f in echo-tts.js echo-transcribe.js; do
  if [[ -f "$WEB/pages-functions/$f" ]]; then
    mkdir -p "$SITE/functions/api"
    cp -a "$WEB/pages-functions/$f" "$SITE/functions/api/$f"
  fi
done

echo "Synced ECHO web → $SITE/public/echo"
echo "Next: from site root, npm run deploy:site  (or deploy:echo for worker-only)"
echo "Worker:  CLOUDFLARE_ACCOUNT_ID=$ACCOUNT_ID bash $ROOT/scripts/deploy-cf.sh"
