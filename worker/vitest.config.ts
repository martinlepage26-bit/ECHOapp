import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "../wrangler.toml" },
        miniflare: {
          // Secrets and vars for tests.
          bindings: {
            ECHO_API_KEY: "test-key",
            ECHO_CLONE_TTS_URL: "http://localhost:9999",
            ECHO_RATE_LIMIT_WINDOW_MS: "10000",
            ECHO_RATE_LIMIT_MAX: "1000",
          },
        },
      },
    },
  },
});
