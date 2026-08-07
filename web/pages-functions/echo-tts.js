// Speech edge for martin.govern-ai.ca/api/echo-tts
//
// Durable path (2026-08-07 permanent repair):
// 1) Sample voices (echo, patricia, martin-en, martin-fr): prefer SpeechT5 clone
// 2) All voices: try echo-ai Worker (Workers AI + Worker-side clone fallback)
// 3) If Worker fails: clone again with Aura→sample mapping (neurons-out, tunnel up)
//
// Never return HTTP 502 from this Function — Cloudflare Pages rewrites bare 502
// into "error code: 502" and strips the JSON body the hardline UI needs.
const DEFAULT_UPSTREAM = "https://echo-ai.martinlepage26.workers.dev/api/echo-tts";
const CLONE_VOICE_IDS = new Set(["echo", "patricia", "martin-en", "martin-fr"]);
// SpeechT5 cold start + trycloudflare hop can exceed 12s; keep long enough for first synth.
const CLONE_TIMEOUT_MS = 90_000;
const WORKER_TIMEOUT_MS = 60_000;

const AURA_TO_SAMPLE = {
  athena: "echo",
  luna: "patricia",
  orion: "martin-en",
  apollo: "martin-fr",
  asteria: "echo",
  hera: "patricia",
  iris: "patricia",
  helena: "patricia",
  andromeda: "echo",
  cordelia: "echo",
  phoebe: "echo",
  thalia: "echo",
  aurora: "echo",
  electra: "echo",
  arcas: "martin-en",
  aries: "martin-en",
  draco: "martin-en",
  jupiter: "martin-en",
  mars: "martin-en",
  odysseus: "martin-en",
  orpheus: "martin-en",
  saturn: "martin-en",
  zeus: "martin-en",
  hermes: "martin-en",
};

function corsHeaders(origin = "*") {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function jsonResponse(payload, status = 200, origin = "*") {
  // Map platform-hostile statuses so the body survives the CF Pages edge.
  const safeStatus = status === 502 || status === 504 ? 503 : status;
  return new Response(JSON.stringify(payload), {
    status: safeStatus,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/json; charset=utf-8",
      "X-Echo-Proxy": "martin-lepage-site-pages-function",
    },
  });
}

function workerUrl(env) {
  return String(env.ECHO_TTS_WORKER_URL || DEFAULT_UPSTREAM).trim() || DEFAULT_UPSTREAM;
}

function cloneUrl(env) {
  const cloneBase = String(env.ECHO_CLONE_TTS_URL || "").trim().replace(/\/+$/, "");
  return cloneBase ? `${cloneBase}/api/tts/raw` : "";
}

function extractVoiceId(bodyText) {
  try {
    const parsed = JSON.parse(bodyText || "{}");
    return String(parsed.voice_id || parsed.voiceId || parsed.voice || "")
      .trim()
      .toLowerCase();
  } catch {
    return "";
  }
}

function mapVoiceForClone(voiceId) {
  const raw = String(voiceId || "").trim().toLowerCase();
  if (CLONE_VOICE_IDS.has(raw)) return raw;
  return AURA_TO_SAMPLE[raw] || "echo";
}

function passthroughHeaders(upstream, origin, via = "worker") {
  const headers = {
    ...corsHeaders(origin || "*"),
    "X-Echo-Proxy": "martin-lepage-site-pages-function",
    "X-Echo-Via": via,
  };

  const contentType = upstream.headers.get("Content-Type");
  if (contentType) headers["Content-Type"] = contentType;

  const disposition = upstream.headers.get("Content-Disposition");
  if (disposition) headers["Content-Disposition"] = disposition;

  for (const name of ["X-Echo-Backend", "X-Echo-Model", "X-Echo-Voice", "X-Echo-Speed"]) {
    const value = upstream.headers.get(name);
    if (value) headers[name] = value;
  }

  return headers;
}

function upstreamAuthHeaders(env, request) {
  const headers = {};
  const browserAuth = request.headers.get("Authorization");
  if (browserAuth) {
    headers.Authorization = browserAuth;
    return headers;
  }
  const secret = String(env.ECHO_API_KEY || env.ECHO_API_SECRET || "").trim();
  if (secret) {
    headers.Authorization = `Bearer ${secret}`;
    headers["X-Echo-Key"] = secret;
  }
  return headers;
}

function normalizeCloneBody(body, voiceId) {
  if (!body) return body;
  try {
    const parsed = JSON.parse(body);
    return JSON.stringify({
      text: parsed.text || "",
      voice_id: voiceId,
      speed: parsed.speed ?? (parsed.rate != null ? 1 + Number(parsed.rate) / 100 : 1.0),
    });
  } catch {
    return body;
  }
}

async function fetchUpstream(url, { method, headers, body, timeoutMs }) {
  const controller = new AbortController();
  const timer = timeoutMs
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;
  try {
    return await fetch(url, {
      method,
      headers,
      body,
      signal: controller.signal,
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Return audio when OK; never pass platform 502 through (body gets stripped). */
async function finalizeUpstream(upstream, origin, via) {
  if (upstream.ok) {
    return new Response(upstream.body, {
      status: upstream.status,
      headers: passthroughHeaders(upstream, origin, via),
    });
  }

  const raw = await upstream.text().catch(() => "");
  let detail = raw.slice(0, 500);
  try {
    const parsed = JSON.parse(raw);
    detail = parsed.detail || parsed.error || detail;
  } catch {
    // keep text
  }
  if (!detail || detail.startsWith("error code:")) {
    detail =
      via === "worker"
        ? "Workers AI speech path failed (often free-neuron exhaustion). Clone fallback also unavailable."
        : "Clone speech path failed.";
  }
  return jsonResponse(
    {
      ok: false,
      error: detail,
      detail,
      via,
      upstream_status: upstream.status,
    },
    upstream.status >= 400 ? upstream.status : 503,
    origin,
  );
}

async function tryClone(cloneTarget, { method, headers, body, voiceId, origin }) {
  if (!cloneTarget || method !== "POST") return null;
  try {
    const cloneRes = await fetchUpstream(cloneTarget, {
      method,
      headers,
      body: normalizeCloneBody(body, voiceId),
      timeoutMs: CLONE_TIMEOUT_MS,
    });
    if (cloneRes.ok) {
      return new Response(cloneRes.body, {
        status: cloneRes.status,
        headers: passthroughHeaders(cloneRes, origin, "clone"),
      });
    }
    console.warn(
      `clone TTS failed status=${cloneRes.status} voice=${voiceId}`,
    );
    return { failed: true, status: cloneRes.status };
  } catch (error) {
    console.warn(
      `clone TTS error voice=${voiceId}: ${String(error?.message || error).slice(0, 200)}`,
    );
    return { failed: true, error: String(error?.message || error).slice(0, 200) };
  }
}

async function proxyRequest(method, context) {
  const origin = context.request.headers.get("Origin") || "*";
  let body = undefined;
  let voiceId = "";
  if (method === "POST") {
    body = await context.request.text();
    voiceId = extractVoiceId(body);
  }

  const headers = {
    "Content-Type": "application/json",
    ...upstreamAuthHeaders(context.env, context.request),
  };
  if (origin && origin !== "*") {
    headers.Origin = origin;
  }

  const cloneTarget = cloneUrl(context.env);
  const workerTarget = workerUrl(context.env);
  const isSampleVoice = CLONE_VOICE_IDS.has(voiceId);

  // 1) Sample profiles: clone first (true speaker colour, no Workers AI neurons).
  if (isSampleVoice) {
    const sampleClone = await tryClone(cloneTarget, {
      method,
      headers,
      body,
      voiceId,
      origin,
    });
    if (sampleClone instanceof Response) return sampleClone;
  }

  // 2) Workers AI path (Worker itself may fall back to clone when ECHO_CLONE_TTS_URL is set).
  let upstream;
  try {
    upstream = await fetchUpstream(workerTarget, {
      method,
      headers,
      body: method === "POST" ? body : undefined,
      timeoutMs: WORKER_TIMEOUT_MS,
    });
  } catch (error) {
    upstream = null;
    console.warn(
      `worker TTS fetch error: ${String(error?.message || error).slice(0, 200)}`,
    );
  }

  if (upstream && upstream.ok) {
    return new Response(upstream.body, {
      status: upstream.status,
      headers: passthroughHeaders(upstream, origin, "worker"),
    });
  }

  // 3) Last resort: clone with Aura→sample mapping (covers System/Aura when neurons are out).
  const mapped = mapVoiceForClone(voiceId || "echo");
  const rescue = await tryClone(cloneTarget, {
    method,
    headers,
    body,
    voiceId: mapped,
    origin,
  });
  if (rescue instanceof Response) return rescue;

  // Surface a readable JSON error (503, never bare 502).
  if (upstream) {
    return finalizeUpstream(upstream, origin, "worker");
  }
  return jsonResponse(
    {
      ok: false,
      error:
        "ECHO speech is unavailable: Workers AI path failed and the local clone origin is down or unset.",
      detail:
        "ECHO speech is unavailable: Workers AI path failed and the local clone origin is down or unset.",
      via: "none",
    },
    503,
    origin,
  );
}

export async function onRequestOptions(context) {
  const origin = context.request.headers.get("Origin") || "*";
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export async function onRequestGet(context) {
  return proxyRequest("GET", context);
}

export async function onRequestPost(context) {
  return proxyRequest("POST", context);
}
