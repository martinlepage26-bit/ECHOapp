import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import worker from '../worker/index.js';
import { VOICE_UNAVAILABLE } from '../worker/tts.js';

const ENV = { TTS_UPSTREAM: 'https://f5tts.example', TTS_ENGINE: 'f5', CF_ACCESS_CLIENT_ID: 'id-x', CF_ACCESS_CLIENT_SECRET: 'secret-x', TTS_TIMEOUT_MS: '50' };
const tts = (body) => new Request('https://reader.example/echo/api/tts', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});
const wav = () => new Response(new Uint8Array([82, 73, 70, 70]), { headers: { 'content-type': 'audio/wav' } });

test('proxies to the tunnel with Access service-token headers and returns audio', async (t) => {
  let seen;
  t.mock.method(globalThis, 'fetch', async (url, init) => { seen = { url, init }; return wav(); });
  const r = await worker.fetch(tts({ text: 'Bonjour.', voice: 'martin' }), ENV);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'audio/wav');
  assert.equal(seen.url, 'https://f5tts.example/tts');
  assert.equal(seen.init.headers['CF-Access-Client-Id'], 'id-x');
  assert.equal(seen.init.headers['CF-Access-Client-Secret'], 'secret-x');
  assert.deepEqual(JSON.parse(seen.init.body), { text: 'Bonjour.', voice: 'martin', engine: 'f5' });
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
  for (const env of [{ ...ENV, CF_ACCESS_CLIENT_SECRET: undefined }, { ...ENV, CF_ACCESS_CLIENT_ID: '' }, { ...ENV, TTS_UPSTREAM: '' }]) {
    const r = await worker.fetch(tts({ text: 'Hi.' }), env);
    assert.equal(r.status, 503);
    assert.equal((await r.json()).error, VOICE_UNAVAILABLE);
  }
  // A public origin is never reachable unauthenticated, even with the local dev flag.
  assert.equal((await worker.fetch(tts({ text: 'Hi.' }), { TTS_UPSTREAM: 'https://f5tts.example', TTS_ALLOW_LOCAL_UNAUTHENTICATED: '1' })).status, 503);
  assert.equal(f.mock.callCount(), 0);
});

test('validates method, body and length', async () => {
  assert.equal((await worker.fetch(new Request('https://reader.example/echo/api/tts'), ENV)).status, 405);
  assert.equal((await worker.fetch(tts({ text: '' }), ENV)).status, 400);
  assert.equal((await worker.fetch(tts({ text: 'x'.repeat(601) }), ENV)).status, 413);
});

test('health reports ready, or 503 when the origin is down', async (t) => {
  const health = new Request('https://reader.example/echo/api/tts/health');
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
