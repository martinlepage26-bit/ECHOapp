/** Echo voice: proxy to the F5-TTS origin behind a Cloudflare Access-protected tunnel. */

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

/* ── Echo voice (F5-TTS via protected tunnel) ───────────────────────── */

export const VOICES = new Set(['echo', 'martin']);
export const ENGINES = new Set(['f5', 'xtts']);
const TTS_MAX_CHARS = 600;
const TTS_DEFAULT_TIMEOUT_MS = 60_000;
export const VOICE_UNAVAILABLE = 'Voix Echo indisponible pour le moment. / Echo voice unavailable right now.';

const unavailable = (reason) =>
  json({ error: VOICE_UNAVAILABLE, reason }, 503);

/** Resolve the upstream and auth headers, or explain why we must fail closed. */
export function ttsUpstream(env = {}) {
  const base = (env.TTS_UPSTREAM || '').trim();
  if (!base) return { error: 'not_configured' };
  let url;
  try { url = new URL(base); } catch { return { error: 'not_configured' }; }
  const local = ['127.0.0.1', 'localhost'].includes(url.hostname);
  const headers = { 'content-type': 'application/json', accept: 'audio/wav' };
  if (env.CF_ACCESS_CLIENT_ID && env.CF_ACCESS_CLIENT_SECRET) {
    headers['CF-Access-Client-Id'] = env.CF_ACCESS_CLIENT_ID;
    headers['CF-Access-Client-Secret'] = env.CF_ACCESS_CLIENT_SECRET;
  } else if (!(local && env.TTS_ALLOW_LOCAL_UNAUTHENTICATED === '1')) {
    // Never reach a public origin without the Access service token.
    return { error: 'missing_secret' };
  }
  if (url.protocol !== 'https:' && !local) return { error: 'not_configured' };
  return { base: url.toString().replace(/\/$/, ''), headers };
}

export async function handleTts(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON.' }, 400); }
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  const voice = body?.voice ?? 'echo';
  if (!text) return json({ error: 'No text given.' }, 400);
  if (Array.from(text).length > TTS_MAX_CHARS) return json({ error: 'Text too long for one clip.' }, 413);
  if (!VOICES.has(voice)) return json({ error: 'Unknown voice.' }, 400);
  const engine = ENGINES.has(env.TTS_ENGINE) ? env.TTS_ENGINE : 'f5';

  const up = ttsUpstream(env);
  if (up.error) return unavailable(up.error);
  const timeout = Number(env.TTS_TIMEOUT_MS) || TTS_DEFAULT_TIMEOUT_MS;
  let response;
  try {
    response = await fetch(`${up.base}/tts`, {
      method: 'POST', headers: up.headers, redirect: 'manual',
      body: JSON.stringify({ text, voice, engine }),
      signal: AbortSignal.timeout(timeout),
    });
  } catch (e) {
    return unavailable(e?.name === 'TimeoutError' ? 'timeout' : 'unreachable');
  }
  const type = (response.headers.get('content-type') || '').toLowerCase();
  if (!response.ok || !type.startsWith('audio/')) return unavailable(`upstream_${response.status}`);
  return new Response(response.body, {
    status: 200,
    headers: { 'content-type': type, 'cache-control': 'no-store', 'x-echo-voice': voice, 'x-echo-engine': engine },
  });
}

export async function handleTtsHealth(env) {
  const up = ttsUpstream(env);
  if (up.error) return unavailable(up.error);
  try {
    const r = await fetch(`${up.base}/health`, { headers: up.headers, redirect: 'manual', signal: AbortSignal.timeout(5000) });
    if (!r.ok) return unavailable(`upstream_${r.status}`);
    const data = await r.json().catch(() => ({}));
    return json({ ready: !!data.ready, voices: [...VOICES], engine: ENGINES.has(env.TTS_ENGINE) ? env.TTS_ENGINE : 'f5' });
  } catch (e) {
    return unavailable(e?.name === 'TimeoutError' ? 'timeout' : 'unreachable');
  }
}
