/** The only voices ECHO speaks with. Both are rendered by the local XTTS-v2 backend via the Worker. */
export const ECHO_VOICES = [
  { id: 'echo', name: 'Echo', lang: 'fr/en', description: 'Original Echo voice' },
  { id: 'martin', name: 'Martin', lang: 'fr/en', description: 'Martin (new reference)' },
];
export const DEFAULT_VOICE = 'echo';
export const VOICE_UNAVAILABLE = 'Echo voice unavailable · Voix Echo indisponible';
const API = `${typeof window !== 'undefined' && window.location?.pathname?.startsWith('/echo') ? '/echo' : ''}/api/tts`;

// Give the engine a natural phrase and enough playing time to prepare the next.
// Tiny clips repeatedly pay the model's setup cost and create gaps.
export const START_CLIP_CHARS = 64;
export const CLIP_CHARS = 80;

// Prefer phrase/word boundaries without dropping text or splitting surrogate pairs.
export function packVoiceClips(text, limit = CLIP_CHARS, firstLimit = limit) {
  if (![limit, firstLimit].every((n) => Number.isInteger(n) && n > 0)) throw new Error('Clip limit must be positive.');
  const chars = Array.from(String(text).trim().replace(/\s+/g, ' '));
  const clips = [];
  while (chars.length) {
    const size = clips.length ? limit : Math.min(firstLimit, limit);
    let end = Math.min(size, chars.length);
    if (end < chars.length) {
      let phraseEnd = 0;
      for (let i = Math.floor(size / 2); i < end; i++) {
        if (/[,.!?;:]/.test(chars[i]) && chars[i + 1] === ' ') phraseEnd = i + 1;
      }
      const space = chars.lastIndexOf(' ', end);
      if (phraseEnd) end = phraseEnd;
      else if (space > size / 2) end = space;
    }
    clips.push(chars.splice(0, end).join('').trim());
    while (chars[0] === ' ') chars.shift();
  }
  return clips.filter(Boolean);
}

async function request(path, { signal, body } = {}) {
  let response;
  try {
    response = await fetch(`${API}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal, credentials: 'same-origin', cache: 'no-store', redirect: 'error',
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error(VOICE_UNAVAILABLE);
  }
  if (!response.ok) throw new Error(VOICE_UNAVAILABLE);
  return response;
}

/** Fail closed: anything but a ready answer means the voice is unavailable. */
export async function checkEchoVoice() {
  const response = await request('/health', { signal: AbortSignal.timeout(6000) });
  const data = await response.json().catch(() => ({}));
  if (!data.ready) throw new Error(VOICE_UNAVAILABLE);
  return data;
}

export function makeRenderer(voice, lang = 'fr') {
  const speakLang = lang === 'en' ? 'en' : 'fr';
  if (!ECHO_VOICES.some((v) => v.id === voice)) throw new Error('Unknown voice.');
  return async function renderClip(text, signal) {
    const timeout = AbortSignal.timeout(90000);
    const response = await request('', { body: { text, voice, lang: speakLang }, signal: AbortSignal.any([signal, timeout]) });
    if (!(response.headers.get('content-type') || '').startsWith('audio/')) throw new Error(VOICE_UNAVAILABLE);
    return response.arrayBuffer();
  };
}

export function initialBufferDelay(renderSeconds, chars, nextChars, duration, rate) {
  if (renderSeconds < 0.3 || !nextChars) return 0; // Cached replay needs no lead.
  const shortage = renderSeconds * nextChars / chars - duration / rate;
  return shortage > 0 ? Math.min(2, shortage + 0.15) : 0;
}

function waitForBuffer(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const stop = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', stop); resolve(); }, milliseconds);
    signal.addEventListener('abort', stop, { once: true });
  });
}

/** One browser audio owner. Each clip is rendered by the Worker voice backend (XTTS-v2 by default). */
export function createEchoPlayer({ render = makeRenderer(DEFAULT_VOICE), makeContext = () => new window.AudioContext(),
  now = () => performance.now(), wait = waitForBuffer } = {}) {
  let context, source, controller, release, paused = false, generation = 0;
  let callbacks, position = 0, total = 1, clipDuration = 0, clipStart = 0, rate = 1;

  function cancel() {
    generation++;
    controller?.abort();
    if (source) { source.onended = null; source.stop(); source.disconnect(); source = null; }
    release?.(); release = null;
    paused = false;
  }

  function unlock() {
    context ||= makeContext();
    // Called synchronously from Play, before awaiting local synthesis.
    return context.resume();
  }

  return {
    start(startIndex, settings, cb) {
      cancel();
      callbacks = cb;
      const run = generation;
      controller = new AbortController();
      const signal = controller.signal;
      const ready = unlock();
      (async () => {
        await ready;
        if (run !== generation) return;
        function* reading() {
          let first = true;
          for (let i = startIndex; i < settings.current.sentences.length; i++) {
            const sentence = settings.current.sentences[i];
            const clips = packVoiceClips(settings.current.spokenFor(sentence).spoken || sentence.text,
              CLIP_CHARS, first ? START_CLIP_CHARS : CLIP_CHARS);
            for (const [n, text] of clips.entries()) yield { sentence: i, position: n, total: clips.length, text };
            first = false;
          }
        }
        const clips = reading();
        let renderTail = Promise.resolve();
        function prepare() {
          const { value: clip, done } = clips.next();
          if (done) return null;
          // Settle failures immediately, including when Stop discards a prefetch.
          // The playback loop bounds lookahead to two clips.
          const previous = renderTail;
          const result = (async () => {
            const earlier = await previous;
            if (earlier?.error) return earlier;
            if (run !== generation) return {};
            const startedAt = now();
            const bytes = await (settings.current.render || render)(clip.text, signal);
            if (run !== generation) return {};
            const renderSeconds = (now() - startedAt) / 1000;
            return { buffer: await context.decodeAudioData(bytes), renderSeconds };
          })().catch((error) => ({ error }));
          // Two buffered clips must still enter the model in reading order.
          renderTail = result;
          return { clip, result };
        }
        let pending = prepare(), sentenceIndex = -1;
        const upcoming = [];
        let started = false;
        function fillUpcoming() {
          while (upcoming.length < 2) {
            const next = prepare();
            if (!next) break;
            upcoming.push(next);
          }
        }
        while (pending) {
          const { clip, result } = pending;
          if (run !== generation) return;
          total = clip.total; position = clip.position; clipDuration = 0;
          if (clip.sentence !== sentenceIndex) {
            sentenceIndex = clip.sentence; cb.onSentence(sentenceIndex);
          }
          cb.onStatus(paused ? 'paused' : 'buffering');
          const { buffer, error, renderSeconds } = await result;
          if (run !== generation) return;
          if (error) throw error;
          if (paused) await new Promise((resolve) => { release = resolve; });
          if (run !== generation) return;
          if (!started) {
            fillUpcoming();
            const lead = initialBufferDelay(renderSeconds, Array.from(clip.text).length,
              Array.from(upcoming[0]?.clip.text || '').length, buffer.duration, settings.current.rate);
            if (lead) await wait(lead * 1000, signal);
            if (run !== generation) return;
            if (paused) await new Promise((resolve) => { release = resolve; });
            if (run !== generation) return;
            started = true;
          }
          source = context.createBufferSource();
          source.buffer = buffer;
          rate = settings.current.rate;
          source.playbackRate.value = rate;
          source.connect(context.destination);
          clipDuration = buffer.duration; clipStart = context.currentTime;
          const ended = new Promise((resolve) => { release = resolve; source.onended = resolve; });
          cb.onStatus('playing');
          source.start();
          // Bank a little audio when synthesis is faster than playback. The
          // voice server serializes model work, and Stop aborts both requests.
          fillUpcoming();
          pending = upcoming.shift();
          await ended;
          if (run !== generation) return;
          source.disconnect(); source = null; release = null;
        }
        if (run === generation) cb.onEnd();
      })().catch((error) => {
        if (run !== generation) return;
        cancel();
        cb.onError(error.name === 'TimeoutError' ? VOICE_UNAVAILABLE : error.message);
      });
    },
    pause() {
      paused = true;
      context?.suspend().catch(() => {});
      callbacks?.onStatus('paused');
    },
    resume() {
      paused = false;
      const run = generation;
      context?.resume().then(() => {
        if (run !== generation || paused) return;
        // A pending render will start playback when it completes.
        if (!source) { release?.(); release = null; }
        callbacks?.onStatus(source ? 'playing' : 'buffering');
      }).catch((error) => callbacks?.onError(error.message));
    },
    progress() {
      const part = clipDuration ? Math.min(1, (context.currentTime - clipStart) * rate / clipDuration) : 0;
      return (position + part) / total;
    },
    cancel,
    dispose() { cancel(); context?.close().catch(() => {}); },
  };
}
