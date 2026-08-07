const DEFAULT_MODEL = "@cf/deepgram/aura-2-en";
const DEFAULT_TRANSCRIBE_MODEL = "@cf/openai/whisper-large-v3-turbo";
const DEFAULT_VOICE = "athena";
const DEFAULT_FORMAT = "mp3";
const DEFAULT_TRANSCRIBE_TASK = "transcribe";
const MAX_TRANSCRIBE_BYTES = 25 * 1024 * 1024;
const DEFAULT_VOICES = [
  "athena",
  "luna",
  "orion",
  "asteria",
  "hera",
  "apollo",
  "iris",
  "ariel",
];
const DEFAULT_ALLOWED_ORIGINS = [
  "https://martinlepage26-bit.github.io",
  "https://martin-lepage-site.pages.dev",
  "https://*.martin-lepage-site.pages.dev",
];

const VOICE_ALIASES = {
  ariel: "athena",
  "ariel-en": "athena",
  voice11: "athena",
};

function parseCsv(raw) {
  return String(raw || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseVoices(env) {
  const configured = parseCsv(env.ECHO_TTS_VOICES);
  return configured.length ? configured : DEFAULT_VOICES;
}

function parseAllowedOrigins(env) {
  const configured = parseCsv(env.ECHO_TTS_ALLOWED_ORIGINS);
  return configured.length ? configured : DEFAULT_ALLOWED_ORIGINS;
}

function originMatches(origin, pattern) {
  if (pattern === "*") {
    return true;
  }
  if (!pattern.includes("*")) {
    return origin === pattern;
  }
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  const matcher = new RegExp(`^${escaped}$`);
  return matcher.test(origin);
}

function isOriginAllowed(origin, allowedOrigins) {
  if (!origin) {
    return false;
  }
  return allowedOrigins.some((pattern) => originMatches(origin, pattern));
}

function normalizeRate(rawRate) {
  const numeric = Number.parseInt(String(rawRate ?? "0"), 10);
  if (Number.isNaN(numeric)) {
    return 0;
  }
  return Math.max(-75, Math.min(75, numeric));
}

function rateToSpeed(rate) {
  const speed = 1 + rate / 100;
  return Math.max(0.5, Math.min(2, Number(speed.toFixed(2))));
}

function normalizeVoice(rawVoice, voiceCatalog) {
  const candidate = String(rawVoice || DEFAULT_VOICE).trim();
  if (!candidate) {
    return DEFAULT_VOICE;
  }

  const mapped = VOICE_ALIASES[candidate.toLowerCase()] || candidate;
  const exact = voiceCatalog.find((voice) => voice.toLowerCase() === mapped.toLowerCase());
  return exact || DEFAULT_VOICE;
}

function safeFilename(name) {
  const cleaned = String(name || "echo-output")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const base = cleaned || "echo-output";
  return base.toLowerCase().endsWith(".mp3") ? base : `${base}.mp3`;
}

function safeInputName(name, fallback = "echo-dictation.webm") {
  const cleaned = String(name || fallback)
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || fallback;
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function jsonResponse(payload, status, origin) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function decodeBase64(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function encodeBase64(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, Math.min(bytes.length, index + chunkSize));
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

function toAudioBody(result) {
  if (result instanceof ReadableStream) {
    return { body: result, contentType: "audio/mpeg" };
  }

  if (result instanceof ArrayBuffer) {
    return { body: result, contentType: "audio/mpeg" };
  }

  if (ArrayBuffer.isView(result)) {
    return { body: result, contentType: "audio/mpeg" };
  }

  if (result && typeof result.audio === "string") {
    return { body: decodeBase64(result.audio), contentType: "audio/wav" };
  }

  if (result && result.audio instanceof ArrayBuffer) {
    return { body: result.audio, contentType: "audio/mpeg" };
  }

  if (result && ArrayBuffer.isView(result.audio)) {
    return { body: result.audio, contentType: "audio/mpeg" };
  }

  throw new Error("Unknown audio payload shape from AI model.");
}

function buildModelInput(model, text, voice, speed) {
  if (model.includes("@cf/myshell-ai/melotts")) {
    return {
      prompt: text,
      speaker: voice,
      speed,
    };
  }

  return {
    text,
    speaker: voice,
    speed,
  };
}

function normalizeLanguage(rawLanguage) {
  const candidate = String(rawLanguage || "").trim();
  if (!candidate) {
    return "";
  }

  const normalized = candidate
    .replace(/_/g, "-")
    .toLowerCase()
    .replace(/[^a-z-]/g, "");

  if (/^[a-z]{2}$/.test(normalized)) {
    return normalized;
  }

  if (/^[a-z]{2}-[a-z]{2}$/.test(normalized)) {
    return normalized;
  }

  return "";
}

function normalizeTranscribeTask(rawTask) {
  const candidate = String(rawTask || DEFAULT_TRANSCRIBE_TASK).trim().toLowerCase();
  return candidate === "translate" ? "translate" : DEFAULT_TRANSCRIBE_TASK;
}

function countWords(text) {
  return String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

async function handleTranscription(request, env, responseOrigin, transcribeModel) {
  const url = new URL(request.url);
  const contentType = String(request.headers.get("Content-Type") || "application/octet-stream").trim();
  const inputName = safeInputName(request.headers.get("X-Echo-Filename"));
  const language = normalizeLanguage(url.searchParams.get("language") || request.headers.get("X-Echo-Language"));
  const task = normalizeTranscribeTask(url.searchParams.get("task") || request.headers.get("X-Echo-Task"));

  let audioBuffer;
  try {
    audioBuffer = await request.arrayBuffer();
  } catch (_error) {
    return jsonResponse({ ok: false, error: "Audio body could not be read." }, 400, responseOrigin);
  }

  if (!audioBuffer.byteLength) {
    return jsonResponse({ ok: false, error: "Audio body is empty." }, 400, responseOrigin);
  }

  if (audioBuffer.byteLength > MAX_TRANSCRIBE_BYTES) {
    return jsonResponse(
      {
        ok: false,
        error: `Audio body exceeds ${MAX_TRANSCRIBE_BYTES} bytes.`,
      },
      413,
      responseOrigin,
    );
  }

  const modelInput = {
    audio: encodeBase64(audioBuffer),
    task,
    vad_filter: true,
    condition_on_previous_text: false,
  };

  if (language) {
    modelInput.language = language;
  }

  let transcriptResult;
  try {
    transcriptResult = await env.AI.run(transcribeModel, modelInput);
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: "Upstream transcription request failed.",
        details: String(error?.message || error).slice(0, 400),
      },
      502,
      responseOrigin,
    );
  }

  const text = String(transcriptResult?.text || "").trim();
  if (!text) {
    return jsonResponse(
      {
        ok: false,
        error: "Transcription returned no text.",
      },
      502,
      responseOrigin,
    );
  }

  const wordCount = Number.isFinite(transcriptResult?.word_count)
    ? transcriptResult.word_count
    : countWords(text);

  return new Response(
    JSON.stringify({
      ok: true,
      text,
      word_count: wordCount,
      segments: Array.isArray(transcriptResult?.segments) ? transcriptResult.segments : [],
      transcription_info:
        transcriptResult?.transcription_info && typeof transcriptResult.transcription_info === "object"
          ? transcriptResult.transcription_info
          : {},
      input: {
        name: inputName,
        contentType,
        sizeBytes: audioBuffer.byteLength,
      },
      task,
      backend: "Cloudflare Workers AI",
      model: transcribeModel,
    }),
    {
      status: 200,
      headers: {
        ...corsHeaders(responseOrigin),
        "Content-Type": "application/json; charset=utf-8",
        "X-Echo-Backend": "Cloudflare Workers AI",
        "X-Echo-Model": transcribeModel,
        "X-Echo-Task": task,
      },
    },
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const origin = request.headers.get("Origin") || "";
    const allowedOrigins = parseAllowedOrigins(env);
    const originAllowed = isOriginAllowed(origin, allowedOrigins);
    const responseOrigin = originAllowed ? origin : "*";
    const voiceCatalog = parseVoices(env);
    const model = (env.ECHO_TTS_MODEL || DEFAULT_MODEL).trim();
    const transcribeModel = (env.ECHO_STT_MODEL || DEFAULT_TRANSCRIBE_MODEL).trim();
    const format = (env.ECHO_TTS_FORMAT || DEFAULT_FORMAT).trim().toLowerCase();

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(responseOrigin),
      });
    }

    if (
      request.method === "GET" &&
      (path === "/" || path === "/health" || path === "/api/echo-tts" || path === "/api/echo-transcribe")
    ) {
      return jsonResponse(
        {
          ok: true,
          mode: "online-only",
          backend: "Cloudflare Workers AI",
          defaults: {
            synthesis: {
              model,
              voice: DEFAULT_VOICE,
              format,
              voices: voiceCatalog,
            },
            transcription: {
              model: transcribeModel,
              task: DEFAULT_TRANSCRIBE_TASK,
              maxBytes: MAX_TRANSCRIBE_BYTES,
            },
          },
        },
        200,
        responseOrigin,
      );
    }

    if (request.method !== "POST" || (path !== "/" && path !== "/api/echo-tts" && path !== "/api/echo-transcribe")) {
      return jsonResponse({ ok: false, error: "Not found." }, 404, responseOrigin);
    }

    const apiSecret = env.ECHO_API_SECRET ? String(env.ECHO_API_SECRET).trim() : "";
    const authHeader = request.headers.get("Authorization") || "";
    const tokenValid = apiSecret !== "" && authHeader === `Bearer ${apiSecret}`;

    if (!originAllowed && !tokenValid) {
      if (authHeader !== "" && !tokenValid) {
        return jsonResponse({ ok: false, error: "Invalid authorization token." }, 401, responseOrigin);
      }
      return jsonResponse({ ok: false, error: "Origin is not allowed for this endpoint." }, 403, responseOrigin);
    }

    if (path === "/api/echo-transcribe") {
      return handleTranscription(request, env, responseOrigin, transcribeModel);
    }

    let body;
    try {
      body = await request.json();
    } catch (_error) {
      return jsonResponse({ ok: false, error: "Request body must be valid JSON." }, 400, responseOrigin);
    }

    const text = String(body.text || "").trim();
    if (!text) {
      return jsonResponse({ ok: false, error: "`text` is required." }, 400, responseOrigin);
    }
    if (text.length > 4000) {
      return jsonResponse({ ok: false, error: "`text` exceeds 4000 characters." }, 400, responseOrigin);
    }

    const rate = normalizeRate(body.rate);
    const speed = rateToSpeed(rate);
    const voice = normalizeVoice(body.voiceId || body.voice, voiceCatalog);
    const filename = safeFilename(body.filename);
    const modelInput = buildModelInput(model, text, voice, speed);

    let audioResult;
    try {
      audioResult = await env.AI.run(model, modelInput);
    } catch (error) {
      return jsonResponse(
        {
          ok: false,
          error: "Upstream synthesis request failed.",
          details: String(error?.message || error).slice(0, 400),
        },
        502,
        responseOrigin,
      );
    }

    let audio;
    try {
      audio = toAudioBody(audioResult);
    } catch (error) {
      return jsonResponse(
        {
          ok: false,
          error: "Synthesis returned an unexpected payload.",
          details: String(error?.message || error),
        },
        502,
        responseOrigin,
      );
    }

    return new Response(audio.body, {
      status: 200,
      headers: {
        ...corsHeaders(responseOrigin),
        "Content-Type": audio.contentType || "audio/mpeg",
        "Content-Disposition": `inline; filename="${filename}"`,
        "X-Echo-Backend": "Cloudflare Workers AI",
        "X-Echo-Model": model,
        "X-Echo-Voice": voice,
        "X-Echo-Speed": String(speed),
      },
    });
  },
};
