/**
 * ECHO worker.
 *
 * Two jobs:
 *  1. Serve the built SPA. It is published under /echo, while the uploaded
 *     files sit at /assets, so the mount prefix is stripped before lookup.
 *  2. Fetch and flatten a web page for the "URL" button. The base44 build sent
 *     the reader's URL through allorigins.win — a third party — so this does it
 *     first-party instead, with the guards a server-side fetcher needs.
 */

import { handleTts, handleTtsHealth } from './tts.js';
import { guardTts } from './access.js';

const MOUNT = '/echo';
const MAX_BYTES = 3 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 3;

/* ── URL safety ──────────────────────────────────────────────────────── */

const BLOCKED_HOSTS = new Set([
  'localhost', 'localhost.localdomain', '127.0.0.1', '0.0.0.0', '::1',
  'metadata.google.internal', 'metadata.goog',
]);

/** Reject anything that resolves to the infrastructure rather than the web. */
function checkTarget(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { error: 'That is not a valid URL.' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { error: 'Only http and https addresses can be read.' };
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (BLOCKED_HOSTS.has(host)) return { error: 'That address is not reachable from here.' };
  if (host.endsWith('.local') || host.endsWith('.internal') || !host.includes('.')) {
    return { error: 'That address is not reachable from here.' };
  }

  // Private and link-local IPv4 literals, including the cloud metadata address.
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = v4.slice(1).map(Number);
    if (a === 10 || a === 127 || a === 0 ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 169 && b === 254) ||
        (a === 100 && b >= 64 && b <= 127)) {
      return { error: 'That address is not reachable from here.' };
    }
  }
  // IPv6 loopback, unique-local and link-local.
  if (host.includes(':') && /^(::1|fc|fd|fe80)/i.test(host)) {
    return { error: 'That address is not reachable from here.' };
  }

  return { url };
}

/* ── HTML → readable text ────────────────────────────────────────────── */

const DROP = 'script,style,noscript,nav,header,footer,aside,form,svg,iframe,button,select,template';
const BLOCK = 'p,div,section,article,li,tr,br,h1,h2,h3,h4,h5,h6,blockquote,pre,figcaption';

/**
 * Flatten a page with HTMLRewriter: drop chrome, keep block structure as line
 * breaks so the sentence splitter has paragraphs to work with.
 */
async function pageToText(response) {
  const chunks = [];
  let title = '';
  let skipDepth = 0;

  const rewriter = new HTMLRewriter()
    .on('title', {
      text(t) { title += t.text; },
    })
    .on(DROP, {
      element(el) {
        skipDepth++;
        el.onEndTag(() => { skipDepth = Math.max(0, skipDepth - 1); });
      },
    })
    .on(BLOCK, {
      element() { if (!skipDepth) chunks.push('\n'); },
    })
    .on('*', {
      text(t) { if (!skipDepth && t.text) chunks.push(t.text); },
    });

  const transformed = rewriter.transform(response);
  const reader = transformed.body.getReader();
  let total = 0;
  // Drain the stream so the rewriter handlers actually run, capped by size.
  while (total < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
  }
  reader.cancel().catch(() => {});

  const text = chunks
    .join('')
    .replace(/\r/g, '')
    .replace(/[\u00A0\u202F\u2009\u200B]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { text, title: title.trim() };
}

/** Read a response body as text, stopping at MAX_BYTES. */
async function readCapped(response) {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let text = '';
  let total = 0;
  while (total < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    text += decoder.decode(value, { stream: true });
  }
  reader.cancel().catch(() => {});
  return text.slice(0, MAX_BYTES);
}

/* ── Handlers ────────────────────────────────────────────────────────── */

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

async function handleExtract(request) {
  const target = new URL(request.url).searchParams.get('url');
  if (!target) return json({ error: 'No URL given.' }, 400);

  const first = checkTarget(/^https?:\/\//i.test(target) ? target : `https://${target}`);
  if (first.error) return json({ error: first.error }, 400);

  let current = first.url;
  let response;

  // Follow redirects by hand so every hop is checked, not just the first.
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    try {
      response = await fetch(current.toString(), {
        redirect: 'manual',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: {
          'user-agent': 'Mozilla/5.0 (compatible; ECHO-Reader/2.0; +https://martin.govern-ai.ca/echo/)',
          accept: 'text/html,application/xhtml+xml,text/plain;q=0.9',
          'accept-language': 'en,fr;q=0.8',
        },
      });
    } catch (e) {
      const timedOut = e?.name === 'TimeoutError';
      return json({ error: timedOut ? 'That page took too long to respond.' : 'That page could not be reached.' }, 502);
    }

    if (response.status < 300 || response.status >= 400) break;
    const location = response.headers.get('location');
    if (!location) break;
    const next = checkTarget(new URL(location, current).toString());
    if (next.error) return json({ error: next.error }, 400);
    current = next.url;
    if (hop === MAX_REDIRECTS) return json({ error: 'That page redirects too many times.' }, 502);
  }

  if (!response.ok) {
    return json({ error: `That page returned ${response.status}.` }, 502);
  }

  const type = (response.headers.get('content-type') || '').toLowerCase();
  if (type.includes('text/plain')) {
    // Read under the same cap the HTML path uses. response.text() would buffer
    // whatever the remote server sends before the slice could bound it.
    const text = (await readCapped(response)).trim();
    return json({ text, title: current.hostname, source: current.toString() });
  }
  if (!type.includes('html') && !type.includes('xml') && type) {
    return json({ error: 'That link is not a readable page — try a PDF or Word import instead.' }, 415);
  }

  const { text, title } = await pageToText(response);
  if (!text) return json({ error: 'No readable text was found on that page.' }, 422);
  return json({ text, title: title || current.hostname, source: current.toString() });
}

/**
 * The asset binding sees paths without the mount, so its own redirects (for
 * example /index.html -> /) would leave the reader. Put the mount back on any
 * same-origin redirect that lacks it: /echo/index.html -> /echo/.
 */
export function remountRedirect(response, requestUrl) {
  if (response.status < 300 || response.status > 399) return response;
  const location = response.headers.get('Location');
  if (!location) return response;
  const origin = new URL(requestUrl).origin;
  const target = new URL(location, origin);
  if (target.origin !== origin) return response;
  if (target.pathname === MOUNT || target.pathname.startsWith(`${MOUNT}/`)) return response;
  target.pathname = `${MOUNT}${target.pathname}`;
  const headers = new Headers(response.headers);
  headers.set('Location', `${target.pathname}${target.search}${target.hash}`);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === `${MOUNT}/api/extract` || url.pathname === '/api/extract') {
      if (request.method !== 'GET') return json({ error: 'Use GET.' }, 405);
      return handleExtract(request);
    }

    if (url.pathname === `${MOUNT}/api/tts` || url.pathname === '/api/tts') {
      if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
      const denied = await guardTts(request, env);
      if (denied) return denied;
      return handleTts(request, env);
    }
    if (url.pathname === `${MOUNT}/api/tts/health` || url.pathname === '/api/tts/health') {
      const denied = await guardTts(request, env);
      if (denied) return denied;
      return handleTtsHealth(env);
    }

    // The bundle is built with its assets at /assets/…, so strip the mount
    // prefix before handing the request to the static asset binding.
    if (url.pathname === MOUNT) url.pathname = '/';
    else if (url.pathname.startsWith(`${MOUNT}/`)) url.pathname = url.pathname.slice(MOUNT.length);

    const response = await env.ASSETS.fetch(new Request(url, request));
    return remountRedirect(response, request.url);
  },
};
