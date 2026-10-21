/**
 * Cloudflare Access gate for the Echo voice API (Argus M1).
 *
 * Every /api/tts* request must carry a valid Access JWT (Cf-Access-Jwt-Assertion):
 * RS256 signature against https://<ACCESS_TEAM_DOMAIN>/cdn-cgi/access/certs, aud in ACCESS_AUD,
 * not expired, issuer = team domain, and email in ACCESS_ALLOWED_EMAILS.
 * Missing config fails closed. Then a per-identity rate limit applies.
 */

const json = (body, status) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

const CERT_TTL_MS = 10 * 60_000;
const certCache = new Map(); // team -> { at, keys: Map(kid -> CryptoKey) }

const b64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4)), (c) => c.charCodeAt(0));
const list = (v) => String(v || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

export function accessConfig(env = {}) {
  const team = String(env.ACCESS_TEAM_DOMAIN || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const auds = String(env.ACCESS_AUD || '').split(',').map((s) => s.trim()).filter(Boolean);
  const emails = list(env.ACCESS_ALLOWED_EMAILS);
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(team) || !auds.length || !emails.length) return null;
  return { team, auds, emails };
}

async function importJwks(jwks) {
  const keys = new Map();
  for (const k of jwks?.keys || []) {
    if (k.kty !== 'RSA' || !k.kid) continue;
    keys.set(k.kid, await crypto.subtle.importKey('jwk', { kty: 'RSA', n: k.n, e: k.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']));
  }
  return keys;
}

/** Test seam: preload a team's JWKS so tests never hit the network. */
export async function primeCerts(team, jwks) { certCache.set(team, { at: Date.now(), keys: await importJwks(jwks) }); }

async function keyFor(team, kid) {
  let entry = certCache.get(team);
  if (!entry || Date.now() - entry.at > CERT_TTL_MS || !entry.keys.has(kid)) {
    const r = await fetch(`https://${team}/cdn-cgi/access/certs`, { redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error('certs');
    entry = { at: Date.now(), keys: await importJwks(await r.json()) };
    certCache.set(team, entry);
  }
  return entry.keys.get(kid);
}

/** Returns { email } or { status, reason }. Never throws. */
export async function verifyAccess(request, env, now = Date.now()) {
  const cfg = accessConfig(env);
  if (!cfg) return { status: 403, reason: 'access_not_configured' };
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) return { status: 401, reason: 'missing_token' };
  try {
    const [h, p, s] = token.split('.');
    if (!h || !p || !s) return { status: 401, reason: 'malformed' };
    const header = JSON.parse(new TextDecoder().decode(b64url(h)));
    const claims = JSON.parse(new TextDecoder().decode(b64url(p)));
    if (header.alg !== 'RS256' || !header.kid) return { status: 401, reason: 'bad_alg' };
    const key = await keyFor(cfg.team, header.kid);
    if (!key) return { status: 401, reason: 'unknown_key' };
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(s), new TextEncoder().encode(`${h}.${p}`));
    if (!ok) return { status: 401, reason: 'bad_signature' };
    const sec = Math.floor(now / 1000);
    if (typeof claims.exp !== 'number' || claims.exp <= sec) return { status: 401, reason: 'expired' };
    if (typeof claims.nbf === 'number' && claims.nbf > sec + 60) return { status: 401, reason: 'not_yet_valid' };
    if (claims.iss !== `https://${cfg.team}`) return { status: 401, reason: 'bad_issuer' };
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.some((a) => cfg.auds.includes(a))) return { status: 403, reason: 'bad_audience' };
    const email = String(claims.email || '').toLowerCase();
    if (!email || !cfg.emails.includes(email)) return { status: 403, reason: 'not_allowed' };
    return { email };
  } catch {
    return { status: 401, reason: 'invalid_token' };
  }
}

/* ── Per-identity rate limit ─────────────────────────────────────────
 * Uses the Workers rate-limiting binding TTS_RATE_LIMITER when bound; otherwise a
 * per-isolate fixed window (TTS_RATE_PER_MIN, default 30). The edge rule in the
 * runbook is the backstop across isolates. */
const windows = new Map();
export function _resetRateLimit() { windows.clear(); }

export async function rateLimit(identity, env, now = Date.now()) {
  if (env.TTS_RATE_LIMITER?.limit) {
    try { const { success } = await env.TTS_RATE_LIMITER.limit({ key: identity }); return success; } catch { return false; }
  }
  const max = Number(env.TTS_RATE_PER_MIN) > 0 ? Number(env.TTS_RATE_PER_MIN) : 30;
  const slot = Math.floor(now / 60_000);
  const w = windows.get(identity);
  if (!w || w.slot !== slot) { windows.set(identity, { slot, n: 1 }); return true; }
  if (w.n >= max) return false;
  w.n++; return true;
}

/** Gate wrapper: returns a Response to send back, or null to continue. */
export async function guardTts(request, env) {
  const v = await verifyAccess(request, env);
  if (!v.email) return json({ error: 'Echo voice requires sign-in. / Connexion requise.', reason: v.reason }, v.status);
  if (!(await rateLimit(v.email, env))) return json({ error: 'Too many requests. / Trop de requêtes.' }, 429);
  return null;
}
