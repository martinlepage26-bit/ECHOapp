import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';

const request = (path, method = 'GET') => new Request(`https://reader.example${path}`, { method });
const extract = (url) => request(`/echo/api/extract?url=${encodeURIComponent(url)}`);

test('serves the reader and assets through both mount spellings', async () => {
  const seen = [];
  const env = { ASSETS: { fetch: async (req) => { seen.push(new URL(req.url).pathname); return new Response('asset'); } } };
  for (const path of ['/echo', '/echo/', '/echo/assets/app.js']) {
    assert.equal(await (await worker.fetch(request(path), env)).text(), 'asset');
  }
  assert.deepEqual(seen, ['/', '/', '/assets/app.js']);
});

test('rejects missing URL and non-GET extraction requests', async () => {
  assert.equal((await worker.fetch(request('/echo/api/extract'), {})).status, 400);
  assert.equal((await worker.fetch(request('/echo/api/extract', 'POST'), {})).status, 405);
});

test('blocks local and metadata literals before any fetch', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('must not fetch'); });
  for (const url of ['http://localhost/', 'http://127.0.0.1/', 'http://10.0.0.1/', 'http://192.168.1.1/', 'http://169.254.169.254/', 'http://100.64.0.1/', 'http://[::1]/', 'http://metadata.google.internal/']) {
    assert.equal((await worker.fetch(extract(url), {})).status, 400, url);
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test('checks redirect destinations before following them', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } }));
  assert.equal((await worker.fetch(extract('https://example.com/article'), {})).status, 400);
  assert.equal(fetch.mock.callCount(), 1);
});

test('returns plain text through the same-origin extraction API', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(' A public passage. ', { headers: { 'content-type': 'text/plain' } }));
  const res = await worker.fetch(extract('https://example.com/article'), {});
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await res.json(), { text: 'A public passage.', title: 'example.com', source: 'https://example.com/article' });
});

test('surfaces upstream errors instead of returning an empty successful import', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('missing', { status: 404 }));
  const res = await worker.fetch(extract('https://example.com/missing'), {});
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /404/);
});

test('asset redirects keep the /echo mount (/echo/index.html -> /echo/)', async () => {
  const env = { ASSETS: { fetch: async (req) => {
    const path = new URL(req.url).pathname;
    if (path === '/index.html') return new Response(null, { status: 307, headers: { Location: '/' } });
    if (path === '/away') return new Response(null, { status: 302, headers: { Location: 'https://other.example/x' } });
    return new Response('asset');
  } } };
  const res = await worker.fetch(request('/echo/index.html'), env);
  assert.equal(res.status, 307);
  assert.equal(res.headers.get('Location'), '/echo/');
  const away = await worker.fetch(request('/echo/away'), env);
  assert.equal(away.headers.get('Location'), 'https://other.example/x');
  assert.equal(await (await worker.fetch(request('/echo/'), env)).text(), 'asset');
});
