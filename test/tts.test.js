import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import worker from '../worker/index.js';
import { VOICE_UNAVAILABLE } from '../worker/tts.js';
import { primeCerts, _resetRateLimit } from '../worker/access.js';

const TEAM = 'echo-test.cloudflareaccess.com';
const AUD = 'aud-echo-123';
const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const pub = await crypto.subtle.exportKey('jwk', kp.publicKey);
await primeCerts(TEAM, { keys: [{ ...pub, kid: 'k1' }] });
const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
export async function jwt(claims = {}, { kid = 'k1', key = kp.privateKey } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const body = `${enc({ alg: 'RS256', kid })}.${enc({ iss: `https://${TEAM}`, aud: [AUD], email: 'martin@example.com', exp: now + 300, iat: now, ...claims })}`;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(body));
  return `${body}.${Buffer.from(sig).toString('base64url')}`;
}
const GOOD = await jwt();
test.beforeEach(() => _resetRateLimit());

const ENV = { TTS_UPSTREAM: 'https://tts.example', TTS_ENGINE: 'xtts', CF_ACCESS_CLIENT_ID: 'id-x', CF_ACCESS_CLIENT_SECRET: 'secret-x', TTS_TIMEOUT_MS: '50', TTS_ORIGIN_TOKEN: 'origin-x',
  ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ACCESS_ALLOWED_EMAILS: 'martin@example.com' };
const tts = (body, token = GOOD) => new Request('https://reader.example/echo/api/tts', {
  method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { 'cf-access-jwt-assertion': token } : {}) }, body: JSON.stringify(body),
});
const wav = () => new Response(new Uint8Array([82, 73, 70, 70]), { headers: { 'content-type': 'audio/wav' } });

test('proxies to the tunnel with Access service-token headers and returns audio', async (t) => {
  let seen;
  t.mock.method(globalThis, 'fetch', async (url, init) => { seen = { url, init }; return wav(); });
  const r = await worker.fetch(tts({ text: 'Bonjour.', voice: 'martin' }), ENV);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'audio/wav');
  assert.equal(seen.url, 'https://tts.example/tts');
  assert.equal(seen.init.headers['CF-Access-Client-Id'], 'id-x');
  assert.equal(seen.init.headers['CF-Access-Client-Secret'], 'secret-x');
  assert.equal(seen.init.headers['X-Echo-Origin-Token'], 'origin-x');
  assert.deepEqual(JSON.parse(seen.init.body), { text: 'Bonjour.', voice: 'martin', engine: 'xtts', lang: 'fr' });
});

test('defaults to the echo voice and rejects voices outside the allowlist', async (t) => {
  let body;
  const f = t.mock.method(globalThis, 'fetch', async (_u, init) => { body = JSON.parse(init.body); return wav(); });
  assert.equal((await worker.fetch(tts({ text: 'Hi.' }), ENV)).status, 200);
  assert.equal(body.voice, 'echo');
  for (const voice of ['patricia', '../echo', '', 1]) {
    assert.equal((await worker.fetch(tts({ text: 'Hi.', voice }), ENV)).status, 400);
  }
  assert.equal(f.mock.callCount(), 1);
});

test('upstream 5xx fails closed with 503 and bilingual message', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('boom', { status: 502 }));
  const r = await worker.fetch(tts({ text: 'Hi.' }), ENV);
  assert.equal(r.status, 503);
  assert.equal((await r.json()).error, VOICE_UNAVAILABLE);
});

test('non-audio success is treated as unavailable', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('<html>login</html>', { headers: { 'content-type': 'text/html' } }));
  assert.equal((await worker.fetch(tts({ text: 'Hi.' }), ENV)).status, 503);
});

test('upstream timeout fails closed with 503', async (t) => {
  t.mock.method(globalThis, 'fetch', (_u, init) => new Promise((_, reject) => {
    // AbortSignal.timeout is unref'd in Node; hold the loop open until it fires.
    const keep = setTimeout(() => {}, 5000);
    init.signal.addEventListener('abort', () => { clearTimeout(keep); reject(init.signal.reason); });
  }));
  const r = await worker.fetch(tts({ text: 'Hi.' }), ENV);
  assert.equal(r.status, 503);
  assert.equal((await r.json()).reason, 'timeout');
});

test('missing Access secret fails closed without contacting the origin', async (t) => {
  const f = t.mock.method(globalThis, 'fetch', async () => wav());
  for (const env of [{ ...ENV, CF_ACCESS_CLIENT_SECRET: undefined }, { ...ENV, CF_ACCESS_CLIENT_ID: '' }, { ...ENV, TTS_UPSTREAM: '' }, { ...ENV, TTS_ORIGIN_TOKEN: '' }]) {
    const r = await worker.fetch(tts({ text: 'Hi.' }), env);
    assert.equal(r.status, 503);
    assert.equal((await r.json()).error, VOICE_UNAVAILABLE);
  }
  // A public origin is never reachable unauthenticated, even with the local dev flag.
  assert.equal((await worker.fetch(tts({ text: 'Hi.' }), { ...ENV, CF_ACCESS_CLIENT_ID: '', TTS_UPSTREAM: 'https://tts.example', TTS_ALLOW_LOCAL_UNAUTHENTICATED: '1' })).status, 503);
  assert.equal(f.mock.callCount(), 0);
});

test('validates method, body and length', async () => {
  assert.equal((await worker.fetch(new Request('https://reader.example/echo/api/tts'), ENV)).status, 405);
  assert.equal((await worker.fetch(tts({ text: '' }), ENV)).status, 400);
  assert.equal((await worker.fetch(tts({ text: 'x'.repeat(601) }), ENV)).status, 413);
});

test('health reports ready, or 503 when the origin is down', async (t) => {
  const health = new Request('https://reader.example/echo/api/tts/health', { headers: { 'cf-access-jwt-assertion': GOOD } });
  t.mock.method(globalThis, 'fetch', async () => Response.json({ ready: true }));
  assert.equal((await (await worker.fetch(health, ENV)).json()).ready, true);
  t.mock.restoreAll();
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('connect failed'); });
  assert.equal((await worker.fetch(health, ENV)).status, 503);
});

function walk(dir) {
  return readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
}
test('the UI has no browser speechSynthesis fallback left', () => {
  const files = [...walk('src'), 'index.html'].filter((f) => /\.(jsx?|html)$/.test(f));
  for (const f of files) {
    assert.doesNotMatch(readFileSync(f, 'utf8'), /speechSynthesis|SpeechSynthesis/, f);
  }
});

test('engine is always xtts; f5 is no longer selectable', async (t) => {
  const bodies = [];
  t.mock.method(globalThis, 'fetch', async (_u, init) => { bodies.push(JSON.parse(init.body)); return wav(); });
  const { TTS_ENGINE: _drop, ...noEngine } = ENV;
  await worker.fetch(tts({ text: 'Salut.' }), noEngine);
  await worker.fetch(tts({ text: 'Salut.' }), { ...ENV, TTS_ENGINE: 'bogus' });
  const r = await worker.fetch(tts({ text: 'Salut.', voice: 'martin' }), { ...ENV, TTS_ENGINE: 'f5' });
  assert.deepEqual(bodies.map((b) => b.engine), ['xtts', 'xtts', 'xtts']);
  assert.equal(r.headers.get('x-echo-voice'), 'martin');
});

test('passes lang (fr default, en allowed) and rejects other languages', async (t) => {
  const bodies = [];
  const f = t.mock.method(globalThis, 'fetch', async (_u, init) => { bodies.push(JSON.parse(init.body)); return wav(); });
  await worker.fetch(tts({ text: 'Hello.', voice: 'echo', lang: 'en' }), ENV);
  assert.equal(bodies[0].lang, 'en');
  assert.equal((await worker.fetch(tts({ text: 'Hallo.', lang: 'de' }), ENV)).status, 400);
  assert.equal(f.mock.callCount(), 1);
});

/* ── Argus M1: Access JWT gate and rate limit ─────────────────────── */

test('no Access JWT: 401 for both voices and health, origin never contacted', async (t) => {
  const f = t.mock.method(globalThis, 'fetch', async () => wav());
  for (const voice of ['martin', 'echo']) assert.equal((await worker.fetch(tts({ text: 'Hi.', voice }, null), ENV)).status, 401);
  assert.equal((await worker.fetch(new Request('https://reader.example/echo/api/tts/health'), ENV)).status, 401);
  assert.equal((await worker.fetch(new Request('https://reader.example/api/tts', { method: 'POST', body: '{}' }), ENV)).status, 401);
  assert.equal(f.mock.callCount(), 0);
});

test('rejects forged, expired, wrong-aud, wrong-issuer and non-allowlisted tokens', async (t) => {
  const f = t.mock.method(globalThis, 'fetch', async () => wav());
  const other = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const cases = [
    [await jwt({}, { key: other.privateKey }), 401],
    [await jwt({ exp: Math.floor(Date.now() / 1000) - 5 }), 401],
    [await jwt({ iss: 'https://evil.cloudflareaccess.com' }), 401],
    [await jwt({ aud: ['other-aud'] }), 403],
    [await jwt({ email: 'stranger@example.com' }), 403],
    [GOOD.split('.').slice(0, 2).join('.') + '.AAAA', 401],
    ['not-a-jwt', 401],
  ];
  for (const [token, status] of cases) assert.equal((await worker.fetch(tts({ text: 'Hi.', voice: 'martin' }, token), ENV)).status, status, token.slice(0, 20));
  assert.equal(f.mock.callCount(), 0);
});

test('missing Access config fails closed (403) even with a token', async (t) => {
  const f = t.mock.method(globalThis, 'fetch', async () => wav());
  for (const k of ['ACCESS_TEAM_DOMAIN', 'ACCESS_AUD', 'ACCESS_ALLOWED_EMAILS']) {
    assert.equal((await worker.fetch(tts({ text: 'Hi.' }), { ...ENV, [k]: '' })).status, 403, k);
  }
  assert.equal(f.mock.callCount(), 0);
});

test('per-identity rate limit returns 429 past the window budget', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => wav());
  const env = { ...ENV, TTS_RATE_PER_MIN: '2' };
  const codes = [];
  for (let i = 0; i < 3; i++) codes.push((await worker.fetch(tts({ text: 'Hi.' }), env)).status);
  assert.deepEqual(codes, [200, 200, 429]);
});

test('uses the Workers rate-limit binding when bound, keyed by identity', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => wav());
  const keys = [];
  const env = { ...ENV, TTS_RATE_LIMITER: { limit: async ({ key }) => { keys.push(key); return { success: false }; } } };
  assert.equal((await worker.fetch(tts({ text: 'Hi.' }), env)).status, 429);
  assert.deepEqual(keys, ['martin@example.com']);
});
