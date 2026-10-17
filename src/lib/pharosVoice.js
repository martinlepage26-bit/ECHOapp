export const PHAROS_ORIGIN = 'http://127.0.0.1:8787';
export const PHAROS_VOICE = {
  id: 'pharos-echo', name: 'PHAROS · Echo', lang: 'en', local: true, pharos: true,
};

// Start with a short phrase, then use longer clips to retain natural phrasing.
export const START_CLIP_CHARS = 24;
export const CLIP_CHARS = 48;

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

async function request(path, { signal, text } = {}) {
  let response;
  try {
    response = await fetch(`${PHAROS_ORIGIN}/api/pharos/${path}`, {
      method: text === undefined ? 'GET' : 'POST',
      headers: { 'X-Echo-Client': 'echo-reader', ...(text === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: text === undefined ? undefined : JSON.stringify({ text }),
      signal, credentials: 'omit', cache: 'no-store', redirect: 'error',
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error('Cannot reach PHAROS on this Mac. Start the ECHO local companion and allow its local connection in your browser.');
  }
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail.error || 'PHAROS voice is unavailable on this Mac.');
  }
  return response;
}

export async function connectPharos() {
  const response = await request('health', { signal: AbortSignal.timeout(5000) });
  const data = await response.json();
  if (data.service !== 'echo-pharos-companion' || !data.ready || data.voice !== 'pharos-echo') {
    throw new Error('PHAROS’s pinned Echo voice is not ready. Start PHAROS’s voice service, then reconnect.');
  }
  return data;
}

async function renderClip(text, signal) {
  const timeout = AbortSignal.timeout(180000);
  const response = await request('speak', { text, signal: AbortSignal.any([signal, timeout]) });
  if (!(response.headers.get('content-type') || '').startsWith('audio/wav')) {
    throw new Error('PHAROS returned no playable audio.');
  }
  return response.arrayBuffer();
}

/** One browser audio owner. The companion reuses PHAROS's resident model. */
export function createPharosPlayer({ render = renderClip, makeContext = () => new window.AudioContext() } = {}) {
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
        function prepare() {
          const { value: clip, done } = clips.next();
          if (done) return null;
          // Settle failures immediately, including when Stop discards a prefetch.
          // At most one next clip is prepared; never enqueue the whole document.
          const result = (async () => {
            if (run !== generation) return {};
            const bytes = await render(clip.text, signal);
            if (run !== generation) return {};
            return { buffer: await context.decodeAudioData(bytes) };
          })().catch((error) => ({ error }));
          return { clip, result };
        }
        let pending = prepare(), sentenceIndex = -1;
        while (pending) {
          const { clip, result } = pending;
          if (run !== generation) return;
          total = clip.total; position = clip.position; clipDuration = 0;
          if (clip.sentence !== sentenceIndex) {
            sentenceIndex = clip.sentence; cb.onSentence(sentenceIndex);
          }
          cb.onStatus(paused ? 'paused' : 'buffering');
          const { buffer, error } = await result;
          if (run !== generation) return;
          if (error) throw error;
          if (paused) await new Promise((resolve) => { release = resolve; });
          if (run !== generation) return;
          source = context.createBufferSource();
          source.buffer = buffer;
          rate = settings.current.rate;
          source.playbackRate.value = rate;
          source.connect(context.destination);
          clipDuration = buffer.duration; clipStart = context.currentTime;
          const ended = new Promise((resolve) => { release = resolve; source.onended = resolve; });
          cb.onStatus('playing');
          source.start();
          pending = prepare();
          await ended;
          if (run !== generation) return;
          source.disconnect(); source = null; release = null;
        }
        if (run === generation) cb.onEnd();
      })().catch((error) => {
        if (run !== generation) return;
        cancel();
        cb.onError(error.name === 'TimeoutError' ? 'PHAROS took too long to render. Try a shorter passage.' : error.message);
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
