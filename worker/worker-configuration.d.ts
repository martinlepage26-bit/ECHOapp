// Generated-style Cloudflare Worker bindings for ECHO.
// Run `npx wrangler types` to refresh after binding changes.

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;

  // [vars]
  ECHO_MOUNT_PREFIX?: string;
  ECHO_RATE_LIMIT_WINDOW_MS?: string;
  ECHO_RATE_LIMIT_MAX?: string;

  // secrets
  ECHO_API_KEY?: string;
  ECHO_CLONE_TTS_URL?: string;
}
