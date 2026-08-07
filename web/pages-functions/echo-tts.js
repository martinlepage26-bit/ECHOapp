// Speech edge for martin.govern-ai.ca/api/echo-tts
//
// Thin proxy. Durability (Workers AI → clone) lives on echo-ai Worker.
// This Function only:
//   1) short-circuits sample voices to the clone origin (true speaker colour)
//   2) otherwise proxies to the Worker
//   3) if the Worker is unreachable, one last clone attempt as "echo"
//
// Never return HTTP 502 — Cloudflare Pages rewrites bare 502 and strips the body.
const DEFAULT_UPSTREAM = "https://echo-ai.martinlepage26.workers.dev/api/echo-tts";
const SAMPLE_VOICE_IDS = new Set(["echo", "patricia", "martin-en", "martin-fr"]);
const CLONE_TIMEOUT_MS = 90_000;
const WORKER_TIMEOUT_MS = 60_000;

function corsHeaders(origin = "*") {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function safeStatus(status) {
  return status === 502 || status === 504 ? 503 : status;
}

function jsonResponse(payload, status = 200, origin = "*") {
  return new Response(JSON.stringify(payload), {
    status: safeStatus(status),
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

function cloneRawUrl(env) {
  const base = String(env.ECHO_CLONE_TTS_URL || "").trim().replace(/\/+$/, "");
  return base ? `${base}/api/tts/raw` : "";
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

function passthroughHeaders(upstream, origin, via) {
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
  const browserAuth = request.headers.get("Authorization");
  if (browserAuth) return { Authorization: browserAuth };
  const secret = String(env.ECHO_API_KEY || env.ECHO_API_SECRET || "").trim();
  if (!secret) return {};
  return { Authorization: `Bearer ${secret}`, "X-Echo-Key": secret };
}

function withCloneVoice(body, voiceId) {
  try {
    const parsed = JSON.parse(body || "{}");
    return JSON.stringify({
      text: parsed.text || "",
      voice_id: voiceId,
      speed: parsed.speed ?? (parsed.rate != null ? 1 + Number(parsed.rate) / 100 : 1.0),
    });
  } catch {
    return body;
  }
}

async function fetchWithTimeout(url, { method, headers, body, timeoutMs }) {
  const controller = new AbortController();
  const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    return await fetch(url, { method, headers, body, signal: controller.signal });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** @returns {Promise<Response|null>} audio response or null on failure */
async function tryClone(cloneTarget, { headers, body, voiceId, origin }) {
  if (!cloneTarget) return null;
  try {
    const res = await fetchWithTimeout(cloneTarget, {
      method: "POST",
      headers,
      body: withCloneVoice(body, voiceId),
      timeoutMs: CLONE_TIMEOUT_MS,
    });
    if (!res.ok) {
      console.warn(`clone TTS status=${res.status} voice=${voiceId}`);
      return null;
    }
    return new Response(res.body, {
      status: res.status,
      headers: passthroughHeaders(res, origin, "clone"),
    });
  } catch (error) {
    console.warn(`clone TTS error voice=${voiceId}: ${String(error?.message || error).slice(0, 200)}`);
    return null;
  }
}

async function errorFromUpstream(upstream, origin, via) {
  const raw = await upstream.text().catch(() => "");
  let detail = raw.slice(0, 500);
  try {
    const parsed = JSON.parse(raw);
    detail = parsed.detail || parsed.error || detail;
  } catch {
    /* keep text */
  }
  if (!detail || detail.startsWith("error code:")) {
    detail = "Upstream ECHO speech service failed.";
  }
  return jsonResponse(
    { ok: false, error: detail, detail, via, upstream_status: upstream.status },
    upstream.status >= 400 ? upstream.status : 503,
    origin,
  );
}

async function proxyRequest(method, context) {
  const origin = context.request.headers.get("Origin") || "*";
  let body;
  let voiceId = "";
  if (method === "POST") {
    body = await context.request.text();
    voiceId = extractVoiceId(body);
  }

  const headers = {
    "Content-Type": "application/json",
    ...upstreamAuthHeaders(context.env, context.request),
  };
  if (origin && origin !== "*") headers.Origin = origin;

  const cloneTarget = cloneRawUrl(context.env);
  const isSample = SAMPLE_VOICE_IDS.has(voiceId);

  // 1) Sample profiles: clone first (true colour, no Worker hop).
  if (method === "POST" && isSample) {
    const hit = await tryClone(cloneTarget, { headers, body, voiceId, origin });
    if (hit) return hit;
  }

  // 2) Worker owns AI + durable clone fallback for all voice ids.
  let upstream = null;
  let workerUnreachable = false;
  try {
    upstream = await fetchWithTimeout(workerUrl(context.env), {
      method,
      headers,
      body: method === "POST" ? body : undefined,
      timeoutMs: WORKER_TIMEOUT_MS,
    });
  } catch (error) {
    workerUnreachable = true;
    console.warn(`worker TTS fetch error: ${String(error?.message || error).slice(0, 200)}`);
  }

  if (upstream?.ok) {
    return new Response(upstream.body, {
      status: upstream.status,
      headers: passthroughHeaders(upstream, origin, "worker"),
    });
  }

  // 3) Worker down or failed: one last clone attempt (samples keep id; others → echo).
  //    Skipped for sample voices that already failed clone in step 1 with the same id.
  if (method === "POST" && cloneTarget && (workerUnreachable || !isSample)) {
    const rescueVoice = isSample ? voiceId : "echo";
    const rescue = await tryClone(cloneTarget, {
      headers,
      body,
      voiceId: rescueVoice,
      origin,
    });
    if (rescue) return rescue;
  }

  if (upstream) return errorFromUpstream(upstream, origin, "worker");
  return jsonResponse(
    {
      ok: false,
      error:
        "ECHO speech is unavailable: Worker unreachable and local clone origin is down or unset.",
      detail:
        "ECHO speech is unavailable: Worker unreachable and local clone origin is down or unset.",
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
