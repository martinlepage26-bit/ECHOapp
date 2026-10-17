import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { packVoiceClips, createPharosPlayer } from '../src/lib/pharosVoice.js';

function setup(render) {
  const events = [], sources = [];
  const context = {
    currentTime: 0, destination: {},
    resume: async () => {}, suspend: async () => {}, close: async () => {},
    decodeAudioData: async () => ({ duration: 2 }),
    createBufferSource() {
      const source = { playbackRate: {}, connect() {}, disconnect() {}, start() { events.push('audio'); }, stop() { events.push('stop'); } };
      sources.push(source); return source;
    },
  };
  const player = createPharosPlayer({ render, makeContext: () => context });
  const settings = { current: { sentences: [{ text: 'Hello Martin.' }], spokenFor: (s) => ({ spoken: s.text }), rate: 1 } };
  const callbacks = {
    onSentence: (n) => events.push(`sentence:${n}`), onStatus: (s) => events.push(s),
    onEnd: () => events.push('end'), onError: (e) => events.push(`error:${e}`),
  };
  return { player, settings, callbacks, events, sources, context };
}

test('clips preserve long tokens and Unicode without exceeding the service limit', () => {
  const text = 'a'.repeat(200) + ' 😀'.repeat(90);
  const clips = packVoiceClips(text);
  assert.ok(clips.every((c) => Array.from(c).length <= 80));
  assert.equal(clips.join('').replace(/\s/g, ''), text.replace(/\s/g, ''));
  assert.throws(() => packVoiceClips('text', 0));
});

test('cancel during synthesis aborts the request and cannot start stale audio', async () => {
  let finish, signal;
  const s = setup((_text, abort) => { signal = abort; return new Promise((r) => { finish = r; }); });
  s.player.start(0, s.settings, s.callbacks); await setImmediate();
  s.player.cancel(); finish(new ArrayBuffer(4)); await setImmediate();
  assert.equal(signal.aborted, true);
  assert.equal(s.sources.length, 0);
  assert.ok(!s.events.includes('end'));
});

test('pausing while rendering holds audio until resume and reports real audio progress', async () => {
  let finish;
  const s = setup(() => new Promise((r) => { finish = r; }));
  s.player.start(0, s.settings, s.callbacks); await setImmediate();
  s.player.pause(); finish(new ArrayBuffer(4)); await setImmediate();
  assert.equal(s.sources.length, 0);
  s.player.resume(); await setImmediate();
  assert.equal(s.sources.length, 1);
  s.context.currentTime = 1;
  assert.equal(s.player.progress(), 0.5);
  s.sources[0].onended(); await setImmediate();
  assert.equal(s.events.at(-1), 'end');
});

test('seeking cancels the old source and starts only the requested sentence', async () => {
  const texts = [];
  const s = setup(async (text) => { texts.push(text); return new ArrayBuffer(4); });
  s.settings.current.sentences.push({ text: 'Second sentence.' });
  s.player.start(0, s.settings, s.callbacks); await setImmediate();
  const staleEnd = s.sources[0].onended;
  s.player.start(1, s.settings, s.callbacks); await setImmediate();
  staleEnd(); await setImmediate();
  assert.deepEqual(texts, ['Hello Martin.', 'Second sentence.']);
  assert.ok(s.events.includes('stop'));
  assert.equal(s.sources.length, 2);
});

test('failed synthesis surfaces its error without substituting a voice', async () => {
  const s = setup(async () => { throw new Error('service offline'); });
  s.player.start(0, s.settings, s.callbacks); await setImmediate();
  assert.equal(s.events.at(-1), 'error:service offline');
  assert.equal(s.sources.length, 0);
});

test('resume followed immediately by stop cannot revive playback status', async () => {
  const s = setup(async () => new ArrayBuffer(4));
  s.player.start(0, s.settings, s.callbacks); await setImmediate();
  s.player.pause(); s.player.resume(); s.player.cancel();
  const count = s.events.length;
  await setImmediate();
  assert.equal(s.events.length, count);
});
