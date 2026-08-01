/**
 * ECHO full stack on Cloudflare Workers.
 *
 * Static Expo UI is served via the ASSETS binding (frontend/dist).
 * API routes (run_worker_first = /api/*):
 *   GET  /api/              — health
 *   GET  /api/voices        — voice catalog
 *   GET  /api/sample-text   — sample draft
 *   POST /api/tts/generate  — JSON {text, voice_id, speed} → TTSResponse
 *   POST /api/stt/transcribe — multipart field "audio" → STTResponse
 *   *    /api/drafts|transcripts|parse-file — 503 (Mongo/storage not on edge)
 *
 * Legacy: POST /api/echo-tts, /api/echo-transcribe
 *
 * Auth: X-Echo-Key (or Authorization: Bearer) must match ECHO_API_KEY when set.
 */

const DEFAULT_TTS_MODEL = "@cf/deepgram/aura-2-en";
const DEFAULT_STT_MODEL = "@cf/openai/whisper-large-v3-turbo";
const DEFAULT_VOICE = "athena";
const MAX_TTS_CHARS = 4000;
const MAX_STT_BYTES = 24 * 1024 * 1024;

/** Aura-2 English speakers with short UI tags (name · style). */
const AURA_VOICES = [
  { id: "athena", name: "Athena", tag: "clear · narration" },
  { id: "luna", name: "Luna", tag: "warm · soft" },
  { id: "orion", name: "Orion", tag: "deep · steady" },
  { id: "asteria", name: "Asteria", tag: "bright · expressive" },
  { id: "hera", name: "Hera", tag: "authoritative · news" },
  { id: "apollo", name: "Apollo", tag: "warm · male" },
  { id: "iris", name: "Iris", tag: "light · friendly" },
  { id: "andromeda", name: "Andromeda", tag: "smooth · storytelling" },
  { id: "arcas", name: "Arcas", tag: "calm · measured" },
  { id: "aries", name: "Aries", tag: "energetic · direct" },
  { id: "aurora", name: "Aurora", tag: "soft · contemplative" },
  { id: "cordelia", name: "Cordelia", tag: "refined · literary" },
  { id: "draco", name: "Draco", tag: "low · dramatic" },
  { id: "electra", name: "Electra", tag: "crisp · modern" },
  { id: "helena", name: "Helena", tag: "gentle · conversational" },
  { id: "hermes", name: "Hermes", tag: "quick · informative" },
  { id: "jupiter", name: "Jupiter", tag: "rich · broadcast" },
  { id: "mars", name: "Mars", tag: "firm · instructional" },
  { id: "odysseus", name: "Odysseus", tag: "story · epic" },
  { id: "orpheus", name: "Orpheus", tag: "musical · lyrical" },
  { id: "phoebe", name: "Phoebe", tag: "bright · youthful" },
  { id: "saturn", name: "Saturn", tag: "mature · grounded" },
  { id: "thalia", name: "Thalia", tag: "playful · light" },
  { id: "zeus", name: "Zeus", tag: "commanding · deep" },
];

function parseCsv(raw) {
  return String(raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function voiceCatalog(env) {
  const configured = parseCsv(env.ECHO_TTS_VOICES);
  if (!configured.length) return AURA_VOICES;
  return configured.map((id) => {
    const known = AURA_VOICES.find((v) => v.id === id);
    return known || { id, name: id, tag: "workers ai · aura" };
  });
}

function defaultVoiceId(env, catalog) {
  const preferred = (env.ECHO_DEFAULT_VOICE || DEFAULT_VOICE).trim();
  if (catalog.some((v) => v.id === preferred)) return preferred;
  return catalog[0]?.id || DEFAULT_VOICE;
}

function clampSpeed(speed) {
  const n = Number(speed);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.max(0.5, Math.min(2, n));
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Echo-Key, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

function json(payload, status, origin, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}

function encodeBase64(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return btoa(binary);
}

function decodeBase64(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function timingSafeEqualString(a, b) {
  const enc = new TextEncoder();
  const aa = enc.encode(String(a || ""));
  const bb = enc.encode(String(b || ""));
  if (aa.byteLength !== bb.byteLength) {
    return false;
  }
  return crypto.subtle.timingSafeEqual(aa, bb);
}

async function authorize(request, env, origin) {
  const required = String(env.ECHO_API_KEY || "").trim();
  const allowedOrigins = parseCsv(env.ECHO_ALLOWED_ORIGINS);

  if (allowedOrigins.length && origin) {
    const originOk = allowedOrigins.some((pattern) => {
      if (pattern === "*") return true;
      if (!pattern.includes("*")) return origin === pattern;
      const re = new RegExp(
        `^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`,
      );
      return re.test(origin);
    });
    if (originOk && !required) return { ok: true };
    // Origin match alone is not enough when a key is configured — key still required.
  }

  if (!required) {
    // Open gate (local / private). Prefer setting ECHO_API_KEY on any public URL.
    return { ok: true };
  }

  const headerKey = request.headers.get("X-Echo-Key") || "";
  const auth = request.headers.get("Authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const presented = headerKey || bearer;

  if (await timingSafeEqualString(presented, required)) {
    return { ok: true };
  }
  return { ok: false, status: 401, error: "Invalid or missing X-Echo-Key." };
}

function estimateWordTimings(text) {
  const tokens = String(text || "").match(/\S+/g) || [];
  let cursor = 0;
  const words = tokens.map((word, index) => {
    const core = word.replace(/^[^\w]+|[^\w]+$/g, "");
    let duration = 0.12 + Math.min(core.length || 1, 16) * 0.028;
    if (/\d/.test(core)) duration += 0.08;
    if (/\.\.\.$|…$/.test(word)) duration += 0.28;
    else if (/[.!?]$/.test(word)) duration += 0.18;
    else if (/[,;:]$/.test(word)) duration += 0.09;
    const start = Number(cursor.toFixed(3));
    cursor += duration;
    return {
      word,
      start,
      end: Number(cursor.toFixed(3)),
      index,
    };
  });
  return { words, estimated_duration: Number(cursor.toFixed(3)) };
}

async function audioResultToBytes(result) {
  if (result instanceof ReadableStream) {
    const res = new Response(result);
    return { bytes: new Uint8Array(await res.arrayBuffer()), mime: "audio/mpeg" };
  }
  if (result instanceof ArrayBuffer) {
    return { bytes: new Uint8Array(result), mime: "audio/mpeg" };
  }
  if (ArrayBuffer.isView(result)) {
    return {
      bytes: new Uint8Array(result.buffer, result.byteOffset, result.byteLength),
      mime: "audio/mpeg",
    };
  }
  if (result && typeof result.audio === "string") {
    return { bytes: decodeBase64(result.audio), mime: "audio/wav" };
  }
  if (result && result.audio instanceof ArrayBuffer) {
    return { bytes: new Uint8Array(result.audio), mime: "audio/mpeg" };
  }
  if (result && ArrayBuffer.isView(result.audio)) {
    const view = result.audio;
    return {
      bytes: new Uint8Array(view.buffer, view.byteOffset, view.byteLength),
      mime: "audio/mpeg",
    };
  }
  throw new Error("Unknown audio payload shape from Workers AI.");
}

function buildTtsInput(model, text, voice, speed) {
  if (model.includes("melotts")) {
    return { prompt: text, speaker: voice, speed };
  }
  // Deepgram Aura: text + speaker + encoding
  return {
    text,
    speaker: voice,
    encoding: "mp3",
  };
}

async function synthesize(env, text, voiceId, speed) {
  const catalog = voiceCatalog(env);
  const model = (env.ECHO_TTS_MODEL || DEFAULT_TTS_MODEL).trim();
  const voice =
    catalog.find((v) => v.id === voiceId)?.id || defaultVoiceId(env, catalog);
  const applied = clampSpeed(speed);
  const input = buildTtsInput(model, text, voice, applied);

  // Aura does not take a speed param the same way as MeloTTS; keep applied for timing scale.
  const raw = await env.AI.run(model, input);
  const { bytes, mime } = await audioResultToBytes(raw);
  if (!bytes.byteLength) {
    throw new Error("Workers AI returned empty audio.");
  }
  return { bytes, mime, voice, applied, model };
}

async function transcribe(env, audioBytes, filename) {
  const model = (env.ECHO_STT_MODEL || DEFAULT_STT_MODEL).trim();
  const result = await env.AI.run(model, {
    audio: encodeBase64(audioBytes),
    task: "transcribe",
    vad_filter: true,
    condition_on_previous_text: false,
  });
  const text = String(result?.text || "").trim();
  if (!text) throw new Error("Transcription returned no text.");
  return { text, model, filename };
}

async function readMultipartAudio(request) {
  const contentType = request.headers.get("Content-Type") || "";
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("audio") || form.get("file");
    if (!file || typeof file === "string") {
      throw new Error('Multipart field "audio" is required.');
    }
    const buf = new Uint8Array(await file.arrayBuffer());
    return { bytes: buf, filename: file.name || "capture.webm" };
  }
  const buf = new Uint8Array(await request.arrayBuffer());
  const filename =
    request.headers.get("X-Echo-Filename") || "capture.webm";
  return { bytes: buf, filename };
}

function pathOf(url) {
  return url.pathname.replace(/\/+$/, "") || "/";
}

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

    // Storage routes need Mongo on the Python API — not available on pure edge deploy.
    if (
      path.startsWith("/api/drafts") ||
      path.startsWith("/api/transcripts") ||
      path === "/api/parse-file"
    ) {
      return json(
        {
          detail:
            "Library storage and file parse are not on the Cloudflare edge deploy. " +
            "Readback and dictation work; use the Python API for drafts/import.",
        },
        503,
        responseOrigin,
      );
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
            { detail: `Text exceeds ${MAX_TTS_CHARS} character limit.` },
            413,
            responseOrigin,
          );
        }
        const voiceId = body.voice_id || body.voiceId || body.voice || "";
        const speed = body.speed ?? (body.rate != null ? 1 + Number(body.rate) / 100 : 1);

        const result = await synthesize(env, text, voiceId, speed);
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

        // Raw audio for legacy clients that expect a binary body on /api/echo-tts
        if (path === "/api/echo-tts" || (path === "/" && body.raw === true)) {
          return new Response(result.bytes, {
            status: 200,
            headers: {
              ...corsHeaders(responseOrigin),
              "Content-Type": result.mime,
              "X-Echo-Backend": "Cloudflare Workers AI",
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
          },
          200,
          responseOrigin,
          {
            "X-Echo-Backend": "Cloudflare Workers AI",
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
        const id = crypto.randomUUID();
        const created_at = new Date().toISOString();
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

      return json({ detail: "Not found." }, 404, responseOrigin);
    } catch (error) {
      const message = String(error?.message || error).slice(0, 400);
      return json(
        {
          detail: message,
          ok: false,
          error: message,
        },
        502,
        responseOrigin,
      );
    }
  },
};
