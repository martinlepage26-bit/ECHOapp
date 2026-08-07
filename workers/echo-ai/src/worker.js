/**
 * ECHO edge router (Cloudflare Worker).
 *
 * Modules:
 *   tts.js      — Workers AI + SpeechT5 clone fallback
 *   stt.js      — Whisper transcription
 *   storage.js  — D1 drafts/transcripts
 *   parse.js    — file text extraction
 *   auth.js     — X-Echo-Key gate
 *   http.js     — CORS / JSON helpers
 *
 * Static Expo UI is served via the ASSETS binding; /api/* hits this script.
 */

import {
  DEFAULT_TTS_MODEL,
  MAX_TTS_CHARS,
  voiceCatalog,
  defaultVoiceId,
  synthesizeLong,
  estimateWordTimings,
  encodeBase64,
  backendLabel,
} from "./tts.js";
import { corsHeaders, json, pathOf } from "./http.js";
import { authorize } from "./auth.js";
import { transcribe, readMultipartAudio, MAX_STT_BYTES } from "./stt.js";
import {
  d1CreateDraft,
  d1ListDrafts,
  d1DeleteDraft,
  d1CreateTranscript,
  d1ListTranscripts,
  d1DeleteTranscript,
  storageUnavailable,
} from "./storage.js";
import { parseUploadedFile, ParseError, MAX_PARSE_BYTES } from "./parse.js";

const SAMPLE_TEXT =
  "ECHO is a browser-native reading surface for listening to drafts out loud. " +
  "Paste text or import a document, choose a voice profile, and hear the language " +
  "back with live word tracking.";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = pathOf(url);
    const origin = request.headers.get("Origin") || "";
    const responseOrigin = origin || "*";

    // Non-API traffic: static Expo export (index, /readback, assets, …).
    if (!path.startsWith("/api") && path !== "/health") {
      if (env.ASSETS) {
        return env.ASSETS.fetch(request);
      }
      return new Response("ECHO UI assets not configured.", { status: 503 });
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(responseOrigin) });
    }

    // Health / discovery (no auth)
    if (
      request.method === "GET" &&
      (path === "/health" ||
        path === "/api" ||
        path === "/api/" ||
        path === "/api/echo-tts" ||
        path === "/api/echo-transcribe")
    ) {
      const catalog = voiceCatalog(env);
      return json(
        {
          service: "echo-ai",
          status: "online",
          backend: "Cloudflare Workers AI",
          provider: "workers_ai",
          ui: "static-assets",
          defaults: {
            tts_model: (env.ECHO_TTS_MODEL || DEFAULT_TTS_MODEL).trim(),
            stt_model: (env.ECHO_STT_MODEL || DEFAULT_STT_MODEL).trim(),
            default_voice: defaultVoiceId(env, catalog),
            voices: catalog.length,
          },
          storage: env.DB ? "d1" : "unavailable",
        },
        200,
        responseOrigin,
      );
    }

    if (request.method === "GET" && path === "/api/voices") {
      const catalog = voiceCatalog(env);
      return json(
        {
          voices: catalog,
          default: defaultVoiceId(env, catalog),
          provider: "workers_ai",
        },
        200,
        responseOrigin,
        { "X-Echo-Backend": "Cloudflare Workers AI" },
      );
    }

    if (request.method === "GET" && path === "/api/sample-text") {
      return json({ text: SAMPLE_TEXT }, 200, responseOrigin);
    }

    // Everything below is gated when ECHO_API_KEY is set.
    const auth = await authorize(request, env, origin);
    if (!auth.ok) {
      return json({ detail: auth.error, ok: false, error: auth.error }, auth.status, responseOrigin);
    }

    try {
      // --- ECHO-compatible TTS ---
      if (request.method === "POST" && (path === "/api/tts/generate" || path === "/api/echo-tts")) {
        let body;
        try {
          body = await request.json();
        } catch {
          return json({ detail: "Request body must be valid JSON." }, 400, responseOrigin);
        }
        const text = String(body.text || "").trim();
        if (!text) return json({ detail: "Text is required." }, 400, responseOrigin);
        if (text.length > MAX_TTS_CHARS) {
          return json(
            {
              detail: `Text exceeds ${MAX_TTS_CHARS.toLocaleString()} characters `
                + "(roughly 10,000 words). Split into smaller passages.",
            },
            413,
            responseOrigin,
          );
        }
        const voiceId = body.voice_id || body.voiceId || body.voice || "";
        const speed = body.speed ?? (body.rate != null ? 1 + Number(body.rate) / 100 : 1);

        const result = await synthesizeLong(env, text, voiceId, speed);
        const { words, estimated_duration } = estimateWordTimings(text);
        const scaled =
          result.applied && result.applied > 0 && result.applied !== 1
            ? {
                words: words.map((w) => ({
                  ...w,
                  start: Number((w.start / result.applied).toFixed(3)),
                  end: Number((w.end / result.applied).toFixed(3)),
                })),
                estimated_duration: Number((estimated_duration / result.applied).toFixed(3)),
              }
            : { words, estimated_duration };

        const label = backendLabel(result);

        // Raw audio for legacy clients that expect a binary body on /api/echo-tts
        if (path === "/api/echo-tts" || (path === "/" && body.raw === true)) {
          return new Response(result.bytes, {
            status: 200,
            headers: {
              ...corsHeaders(responseOrigin),
              "Content-Type": result.mime,
              "X-Echo-Backend": label,
              "X-Echo-Model": result.model,
              "X-Echo-Voice": result.voice,
              "X-Echo-Speed": String(result.applied),
            },
          });
        }

        return json(
          {
            audio_base64: encodeBase64(result.bytes),
            mime: result.mime,
            voice_id: result.voice,
            word_count: scaled.words.length,
            char_count: text.length,
            words: scaled.words,
            estimated_duration: scaled.estimated_duration,
            backend: result.backend || "workers_ai",
          },
          200,
          responseOrigin,
          {
            "X-Echo-Backend": label,
            "X-Echo-Model": result.model,
            "X-Echo-Voice": result.voice,
          },
        );
      }

      // --- ECHO-compatible STT ---
      if (
        request.method === "POST" &&
        (path === "/api/stt/transcribe" || path === "/api/echo-transcribe")
      ) {
        const { bytes, filename } = await readMultipartAudio(request);
        if (!bytes.byteLength) {
          return json({ detail: "Empty audio payload." }, 400, responseOrigin);
        }
        if (bytes.byteLength > MAX_STT_BYTES) {
          return json({ detail: "Audio over 24 MB." }, 413, responseOrigin);
        }
        const result = await transcribe(env, bytes, filename);
        let id = crypto.randomUUID();
        let created_at = new Date().toISOString();
        if (env.DB) {
          // Mirrors the Python API, which auto-saves every transcription to Mongo so it
          // shows up in Library without an extra save step. Storage failure must not break
          // dictation itself — the transcript still returns to the caller either way.
          try {
            const saved = await d1CreateTranscript(env, result.text, null);
            id = saved.id;
            created_at = saved.created_at;
          } catch (e) {
            console.error("transcript autosave failed", e);
          }
        }
        return json(
          {
            id,
            transcript: result.text,
            text: result.text,
            created_at,
            duration: null,
            ok: true,
            model: result.model,
          },
          200,
          responseOrigin,
          {
            "X-Echo-Backend": "Cloudflare Workers AI",
            "X-Echo-Model": result.model,
          },
        );
      }

      // --- Drafts (D1) ---
      if (path === "/api/drafts" && request.method === "GET") {
        if (!env.DB) return storageUnavailable(responseOrigin);
        return json(await d1ListDrafts(env), 200, responseOrigin);
      }
      if (path === "/api/drafts" && request.method === "POST") {
        if (!env.DB) return storageUnavailable(responseOrigin);
        let body;
        try {
          body = await request.json();
        } catch {
          return json({ detail: "Request body must be valid JSON." }, 400, responseOrigin);
        }
        const text = String(body.text || "").trim();
        if (!text) return json({ detail: "Text is required." }, 400, responseOrigin);
        const title = String(body.title || "").trim() || "Untitled draft";
        return json(await d1CreateDraft(env, title, text), 200, responseOrigin);
      }
      const draftMatch = path.match(/^\/api\/drafts\/([^/]+)$/);
      if (draftMatch && request.method === "DELETE") {
        if (!env.DB) return storageUnavailable(responseOrigin);
        const changes = await d1DeleteDraft(env, draftMatch[1]);
        if (!changes) return json({ detail: "Draft not found" }, 404, responseOrigin);
        return json({ deleted: changes, id: draftMatch[1] }, 200, responseOrigin);
      }

      // --- Transcripts (D1) ---
      if (path === "/api/transcripts" && request.method === "GET") {
        if (!env.DB) return storageUnavailable(responseOrigin);
        return json(await d1ListTranscripts(env), 200, responseOrigin);
      }
      if (path === "/api/transcripts" && request.method === "POST") {
        if (!env.DB) return storageUnavailable(responseOrigin);
        let body;
        try {
          body = await request.json();
        } catch {
          return json({ detail: "Request body must be valid JSON." }, 400, responseOrigin);
        }
        const text = String(body.text || "").trim();
        if (!text) return json({ detail: "Text is required." }, 400, responseOrigin);
        const duration = typeof body.duration === "number" ? body.duration : null;
        return json(await d1CreateTranscript(env, text, duration), 200, responseOrigin);
      }
      const transcriptMatch = path.match(/^\/api\/transcripts\/([^/]+)$/);
      if (transcriptMatch && request.method === "DELETE") {
        if (!env.DB) return storageUnavailable(responseOrigin);
        const changes = await d1DeleteTranscript(env, transcriptMatch[1]);
        if (!changes) return json({ detail: "Transcript not found" }, 404, responseOrigin);
        return json({ deleted: changes, id: transcriptMatch[1] }, 200, responseOrigin);
      }

      // --- File parsing ---
      if (path === "/api/parse-file" && request.method === "POST") {
        const contentType = request.headers.get("Content-Type") || "";
        if (!contentType.includes("multipart/form-data")) {
          return json(
            { detail: 'Send the file as multipart/form-data field "file".' },
            400,
            responseOrigin,
          );
        }
        const form = await request.formData();
        const file = form.get("file") || form.get("audio");
        if (!file || typeof file === "string") {
          return json({ detail: 'Multipart field "file" is required.' }, 400, responseOrigin);
        }
        if (file.size > MAX_PARSE_BYTES) {
          return json({ detail: "File over 12 MB." }, 413, responseOrigin);
        }
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (!bytes.byteLength) return json({ detail: "Empty file." }, 400, responseOrigin);

        let text;
        try {
          text = await parseUploadedFile(bytes, file.name || "file");
        } catch (e) {
          if (e instanceof ParseError) return json({ detail: e.detail }, e.status, responseOrigin);
          return json(
            { detail: `Parse failed: ${String(e?.message || e).slice(0, 200)}` },
            500,
            responseOrigin,
          );
        }
        text = text.trim();
        const words = (text.match(/\S+/g) || []).length;
        return json(
          { text, filename: file.name || "file", word_count: words, char_count: text.length },
          200,
          responseOrigin,
        );
      }

      return json({ detail: "Not found." }, 404, responseOrigin);
    } catch (error) {
      // Prefer 503 over 502: Cloudflare Pages rewrites bare 502 and strips the body.
      // synthesizeLong already humanizes dual AI/clone failures; other paths pass through.
      const message = String(error?.message || error).slice(0, 400);
      return json(
        {
          detail: message,
          ok: false,
          error: message,
        },
        503,
        responseOrigin,
      );
    }
  },
};
