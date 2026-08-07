// Speech edge: ECHO Workers AI (Whisper STT). Override with Pages env ECHO_STT_WORKER_URL.
const DEFAULT_UPSTREAM = "https://echo-ai.martinlepage26.workers.dev/api/echo-transcribe";

function corsHeaders(origin = "*") {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Echo-Filename, X-Echo-Language, X-Echo-Task",
  };
}

function jsonResponse(payload, status = 200, origin = "*") {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function upstreamUrl(env, requestUrl) {
  const target = new URL(String(env.ECHO_STT_WORKER_URL || DEFAULT_UPSTREAM).trim() || DEFAULT_UPSTREAM);
  target.search = requestUrl.search;
  return target.toString();
}

function passthroughHeaders(upstream, origin) {
  const headers = {
    ...corsHeaders(origin || "*"),
    "X-Echo-Proxy": "martin-lepage-site-pages-function",
  };

  const contentType = upstream.headers.get("Content-Type");
  if (contentType) {
    headers["Content-Type"] = contentType;
  }

  const echoBackend = upstream.headers.get("X-Echo-Backend");
  const echoModel = upstream.headers.get("X-Echo-Model");
  const echoTask = upstream.headers.get("X-Echo-Task");
  if (echoBackend) headers["X-Echo-Backend"] = echoBackend;
  if (echoModel) headers["X-Echo-Model"] = echoModel;
  if (echoTask) headers["X-Echo-Task"] = echoTask;

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

async function proxyRequest(method, context) {
  const origin = context.request.headers.get("Origin") || "*";
  const requestUrl = new URL(context.request.url);
  const target = upstreamUrl(context.env, requestUrl);
  const headers = {
    ...upstreamAuthHeaders(context.env, context.request),
  };

  const contentType = context.request.headers.get("Content-Type");
  const language = context.request.headers.get("X-Echo-Language");
  const filename = context.request.headers.get("X-Echo-Filename");
  const task = context.request.headers.get("X-Echo-Task");

  if (origin && origin !== "*") {
    headers.Origin = origin;
  }
  if (contentType) {
    headers["Content-Type"] = contentType;
  }
  if (language) {
    headers["X-Echo-Language"] = language;
  }
  if (filename) {
    headers["X-Echo-Filename"] = filename;
  }
  if (task) {
    headers["X-Echo-Task"] = task;
  }

  let upstream;
  try {
    upstream = await fetch(target, {
      method,
      headers,
      body: method === "POST" ? context.request.body : undefined,
    });
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: "Upstream ECHO transcription worker is unavailable.",
        details: String(error?.message || error).slice(0, 300),
      },
      502,
      origin,
    );
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: passthroughHeaders(upstream, origin),
  });
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
