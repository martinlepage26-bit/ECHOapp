/**
 * ECHO edge runtime — one Worker for static assets and /api/*.
 *
 * Responsibilities:
 *   - Serve the single-page UI from the [assets] binding.
 *   - Route /api/health, /api/voices, /api/sample-text (public).
 *   - Route /api/tts (clone voices only), /api/parse, /api/drafts (auth-gated when ECHO_API_KEY is set).
 *   - System voices are synthesized client-side; the Worker only serves clone voices.
 */

import { corsHeaders, json, noContent } from "./http.js";
import { authorize, authError } from "./auth.js";
import { createDraft, deleteDraft, listDrafts, storageUnavailable } from "./storage.js";
import { parseUploadedFile, ParseError, MAX_PARSE_BYTES } from "./parse.js";
import {
  MAX_TTS_CHARS,
  voiceCatalog,
  defaultVoiceId,
  synthesize,
  estimateWordTimings,
  encodeBase64,
  clampSpeed,
  humanizeTtsError,
} from "./tts.js";
import { RateLimiter } from "./rate-limit.js";
import { checkHealth } from "./health.js";

let rateLimiter: RateLimiter | null = null;

function getRateLimiter(env: Env): RateLimiter {
  if (!rateLimiter) {
    const windowMs = Math.max(1000, Number(env.ECHO_RATE_LIMIT_WINDOW_MS || 60_000));
    const maxRequests = Math.max(1, Number(env.ECHO_RATE_LIMIT_MAX || 60));
    rateLimiter = new RateLimiter({ windowMs, maxRequests });
  }
  return rateLimiter;
}

const SAMPLE_TEXT =
  "ECHO is a browser-native reading surface for listening to drafts out loud. " +
  "Paste text or import a document, choose a voice profile, and hear the language " +
  "back with live word tracking.";

function pathOf(url: URL): string {
  return url.pathname.replace(/\/+$/, "") || "/";
}

function stripMountPrefix(path: string, prefix: string): string {
  if (!prefix || prefix === "/") return path;
  const normalized = prefix.replace(/\/+$/, "");
  if (path === normalized) return "/";
  if (path.startsWith(`${normalized}/`)) return path.slice(normalized.length);
  return path;
}

function clientIp(request: Request): string {
  return (
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const rawPath = pathOf(url);
    const mountPrefix = (env.ECHO_MOUNT_PREFIX || "").trim();
    const path = stripMountPrefix(rawPath, mountPrefix);
    const origin = request.headers.get("Origin") || "";

    // Static UI assets (and SPA fallback) are served by the [assets] binding.
    if (!path.startsWith("/api")) {
      if (env.ASSETS) {
        // When mounted under a prefix (e.g. /echo), rewrite the URL so the
        // assets binding can resolve ui/dist/index.html and ui/dist/assets/*.
        const assetUrl = new URL(request.url);
        if (mountPrefix && mountPrefix !== "/") {
          const normalized = mountPrefix.replace(/\/+$/, "");
          if (assetUrl.pathname === normalized) {
            assetUrl.pathname = "/";
          } else if (assetUrl.pathname.startsWith(`${normalized}/`)) {
            assetUrl.pathname = assetUrl.pathname.slice(normalized.length);
          }
        }

        const assetRequest = new Request(assetUrl, request);
        const response = await env.ASSETS.fetch(assetRequest);
        // SPA fallback: unknown client routes get index.html.
        if (response.status === 404 && !assetUrl.pathname.startsWith("/assets/")) {
          const fallback = new URL(assetUrl);
          fallback.pathname = "/";
          return env.ASSETS.fetch(new Request(fallback, request));
        }
        return response;
      }
      return new Response("ECHO UI assets not configured.", { status: 503 });
    }

    if (request.method === "OPTIONS") {
      return noContent(origin);
    }

    // Public discovery endpoints.
    if (request.method === "GET" && path === "/api/health") {
      const providers = await checkHealth(env);
      return json(
        {
          service: "echo",
          status: "online",
          default_voice: defaultVoiceId(),
          voices: voiceCatalog().length,
          storage: env.DB ? "d1" : "unavailable",
          providers,
        },
        200,
        origin,
      );
    }

    if (request.method === "GET" && path === "/api/voices") {
      return json({ voices: voiceCatalog(), default: defaultVoiceId() }, 200, origin);
    }

    if (request.method === "GET" && path === "/api/sample-text") {
      return json({ text: SAMPLE_TEXT }, 200, origin);
    }

    // Everything past this point is gated when ECHO_API_KEY is set.
    const auth = await authorize(request, env);
    if (!auth.ok) {
      return authError(origin);
    }

    try {
      // --- TTS ---
      if (request.method === "POST" && path === "/api/tts") {
        const limit = getRateLimiter(env).isAllowed(clientIp(request));
        if (!limit.allowed) {
          return json(
            { detail: "Rate limit exceeded. Slow down." },
            429,
            origin,
            { "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)) },
          );
        }

        let body: Record<string, unknown>;
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          return json({ detail: "Request body must be valid JSON." }, 400, origin);
        }

        const text = String(body.text || "").trim();
        if (!text) return json({ detail: "text is required." }, 400, origin);
        if (text.length > MAX_TTS_CHARS) {
          return json(
            {
              detail:
                `Text exceeds ${MAX_TTS_CHARS.toLocaleString()} characters ` +
                "(roughly 10,000 words). Split into smaller passages.",
            },
            413,
            origin,
          );
        }

        const voiceId = String(body.voice_id || body.voiceId || body.voice || defaultVoiceId());
        const speed = clampSpeed(body.speed ?? 1);

        const result = await synthesize(env, text, voiceId, speed);
        const { words, estimated_duration } = estimateWordTimings(text);
        const scaled =
          result.speed && result.speed > 0 && result.speed !== 1
            ? {
                words: words.map((w) => ({
                  ...w,
                  start: Number((w.start / result.speed).toFixed(3)),
                  end: Number((w.end / result.speed).toFixed(3)),
                })),
                estimated_duration: Number((estimated_duration / result.speed).toFixed(3)),
              }
            : { words, estimated_duration };

        return json(
          {
            audio_base64: encodeBase64(result.bytes),
            mime: result.mime,
            voice_id: result.voice_id,
            provider: result.provider,
            word_count: scaled.words.length,
            char_count: text.length,
            words: scaled.words,
            estimated_duration: scaled.estimated_duration,
          },
          200,
          origin,
          {
            "X-Echo-Provider": result.provider,
            "X-Echo-Model": result.model,
            "X-Echo-Voice": result.voice_id,
          },
        );
      }

      // --- File parsing ---
      if (request.method === "POST" && path === "/api/parse") {
        const limit = getRateLimiter(env).isAllowed(clientIp(request));
        if (!limit.allowed) {
          return json(
            { detail: "Rate limit exceeded. Slow down." },
            429,
            origin,
            { "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)) },
          );
        }

        const contentType = request.headers.get("Content-Type") || "";
        if (!contentType.includes("multipart/form-data")) {
          return json({ detail: 'Send the file as multipart/form-data field "file".' }, 400, origin);
        }

        const form = await request.formData();
        const file = form.get("file") || form.get("audio");
        if (!file || typeof file === "string") {
          return json({ detail: 'Multipart field "file" is required.' }, 400, origin);
        }
        if (file.size > MAX_PARSE_BYTES) {
          return json({ detail: "File over 12 MB." }, 413, origin);
        }

        const bytes = new Uint8Array(await file.arrayBuffer());
        if (!bytes.byteLength) return json({ detail: "Empty file." }, 400, origin);

        try {
          const parsed = await parseUploadedFile(bytes, file.name || "file");
          return json({ ...parsed, filename: file.name || "file" }, 200, origin);
        } catch (e) {
          if (e instanceof ParseError) return json({ detail: e.detail }, e.status, origin);
          return json(
            { detail: `Parse failed: ${String((e as Error)?.message || e).slice(0, 200)}` },
            500,
            origin,
          );
        }
      }

      // --- Drafts ---
      if (path === "/api/drafts" && request.method === "GET") {
        if (!env.DB) return storageUnavailable(origin);
        return json(await listDrafts(env), 200, origin);
      }

      if (path === "/api/drafts" && request.method === "POST") {
        if (!env.DB) return storageUnavailable(origin);
        let body: Record<string, unknown>;
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          return json({ detail: "Request body must be valid JSON." }, 400, origin);
        }
        const text = String(body.text || "").trim();
        if (!text) return json({ detail: "text is required." }, 400, origin);
        const title = String(body.title || "").trim() || "Untitled draft";
        return json(await createDraft(env, title, text), 200, origin);
      }

      const draftMatch = path.match(/^\/api\/drafts\/([^/]+)$/);
      if (draftMatch && request.method === "DELETE") {
        if (!env.DB) return storageUnavailable(origin);
        const changes = await deleteDraft(env, draftMatch[1]);
        if (!changes) return json({ detail: "Draft not found" }, 404, origin);
        return json({ deleted: changes, id: draftMatch[1] }, 200, origin);
      }

      return json({ detail: "Not found." }, 404, origin);
    } catch (error) {
      const { code, detail } = humanizeTtsError(error);
      return json({ detail, code }, 503, origin);
    }
  },
} satisfies ExportedHandler<Env>;
