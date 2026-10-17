import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { splitSentences, countWords } from '@/lib/sentences';
import { verbalizeSentence, SUPPORTED } from '@/lib/verbalize';
import { detectLanguage } from '@/lib/language';

export const SAMPLE_TEXT = `Invoice #INV-2026-0042 totals $12,480.75, due 2026-09-30.

It covers 3 units at $4,160.25 each, plus 14.5% tax and a $250 delivery fee. The serial on the crate reads A4-9920-XJ; the tracking number is 1Z999AA10123456784.

Questions go to ml@pharos-ai.ca or 514-555-0123 before 14:30 on weekdays. Payment terms run 30-45 days, and the warranty covers 2026-2029.`;

/**
 * Rough speaking rate in characters per second at rate 1.0. A typical system
 * voice runs near 170 words per minute and an English word averages about six
 * characters with its space, so ~16 c/s. Used for the duration estimate and
 * for the stall watchdog's patience, which is why it errs slightly slow.
 */
const CHARS_PER_SECOND = 16;

/** How long to wait past a sentence's expected end before assuming a stall. */
const STALL_GRACE_MS = 4000;

export function useSpeech() {
  const [text, setText] = useState('');
  const [analysisText, setAnalysisText] = useState('');
  const [systemVoices, setSystemVoices] = useState([]);
  const [selectedVoiceId, setSelectedVoiceId] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | playing | paused
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [rate, setRate] = useState(1);
  const [decipher, setDecipher] = useState(true);
  const [subProgress, setSubProgress] = useState(0);
  const [error, setError] = useState(null);
  const [supported, setSupported] = useState(true);

  const genRef = useRef(0);
  const startedAtRef = useRef(0);
  const expectedMsRef = useRef(0);
  const indexRef = useRef(-1);
  const resumeIndexRef = useRef(0);
  const pendingPlayRef = useRef(false);

  /* ── Derived text analysis (debounced: typing should stay responsive) ── */

  useEffect(() => {
    const id = setTimeout(() => setAnalysisText(text), 180);
    return () => clearTimeout(id);
  }, [text]);

  const sentences = useMemo(() => splitSentences(analysisText), [analysisText]);
  const wordCount = useMemo(() => countWords(analysisText), [analysisText]);
  const detected = useMemo(() => detectLanguage(analysisText), [analysisText]);
  const langCode = detected?.code || 'en';
  const decipherAvailable = SUPPORTED.has(langCode);

  // Verbalizing 10k words costs ~400ms, so it happens one sentence at a time,
  // right before that sentence is spoken, and the result is cached.
  const cacheRef = useRef(new Map());
  useEffect(() => { cacheRef.current = new Map(); }, [langCode, decipher]);

  const spokenFor = useCallback((sentence) => {
    if (!sentence) return { spoken: '', changes: [] };
    if (!decipher || !decipherAvailable) return { spoken: sentence.text, changes: [] };
    const hit = cacheRef.current.get(sentence.text);
    if (hit) return hit;
    const result = verbalizeSentence(sentence.text, langCode);
    if (cacheRef.current.size > 4000) cacheRef.current.clear();
    cacheRef.current.set(sentence.text, result);
    return result;
  }, [decipher, decipherAvailable, langCode]);

  /* ── Voices ───────────────────────────────────────────────────────── */

  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      setSupported(false);
      return;
    }
    const load = () => {
      const list = window.speechSynthesis.getVoices();
      if (list && list.length) setSystemVoices(list);
    };
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
    // Safari populates the list lazily and fires no event on first paint.
    const retry = setTimeout(load, 400);
    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', load);
      clearTimeout(retry);
    };
  }, []);

  const voices = useMemo(
    () => systemVoices.map((v, i) => ({
      id: `${v.voiceURI || v.name}::${i}`,
      name: v.name,
      lang: v.lang,
      local: v.localService,
      _voice: v,
    })),
    [systemVoices],
  );

  // Follow the document's language unless the reader has chosen a voice.
  const pickedRef = useRef(false);
  useEffect(() => {
    if (pickedRef.current || voices.length === 0) return;
    const prefix = langCode.toLowerCase();
    const match =
      voices.find((v) => v.local && (v.lang || '').toLowerCase().startsWith(prefix)) ||
      voices.find((v) => (v.lang || '').toLowerCase().startsWith(prefix)) ||
      voices.find((v) => v.local) ||
      voices[0];
    if (match) setSelectedVoiceId(match.id);
  }, [voices, langCode]);

  const selectedVoice = voices.find((v) => v.id === selectedVoiceId) || voices[0];

  const chooseVoice = useCallback((id) => {
    pickedRef.current = true;
    setSelectedVoiceId(id);
  }, []);

  /* ── Playback ─────────────────────────────────────────────────────── */

  const estimatedSeconds = useMemo(
    () => Math.ceil((analysisText.length / CHARS_PER_SECOND) / (rate || 1)),
    [analysisText.length, rate],
  );

  const hardStop = useCallback(() => {
    genRef.current++;
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  }, []);

  const stop = useCallback(() => {
    hardStop();
    indexRef.current = -1;
    resumeIndexRef.current = 0;
    setCurrentIndex(-1);
    setSubProgress(0);
    setStatus('idle');
  }, [hardStop]);

  // Held in a ref so the utterance callbacks always see current settings
  // without tearing down playback on every rate or voice change.
  const settingsRef = useRef({});
  settingsRef.current = { rate, selectedVoice, sentences, spokenFor, langCode };

  const speakFrom = useCallback((startIndex) => {
    const gen = ++genRef.current;
    const run = (i) => {
      const { sentences: list, selectedVoice: voice, rate: r, spokenFor: say, langCode: lc } = settingsRef.current;
      if (gen !== genRef.current) return;
      if (i >= list.length) {
        // Reaching the end rewinds; otherwise the next Play would replay only
        // the final sentence.
        indexRef.current = -1;
        resumeIndexRef.current = 0;
        setCurrentIndex(-1);
        setSubProgress(0);
        setStatus('idle');
        return;
      }

      const sentence = list[i];
      const { spoken } = say(sentence);
      const utterance = new SpeechSynthesisUtterance(spoken || sentence.text);
      if (voice?._voice) utterance.voice = voice._voice;
      utterance.lang = voice?.lang || lc;
      utterance.rate = r;

      indexRef.current = i;
      resumeIndexRef.current = i;
      setCurrentIndex(i);
      setSubProgress(0);
      startedAtRef.current = Date.now();
      expectedMsRef.current = ((spoken || sentence.text).length / CHARS_PER_SECOND / r) * 1000;

      let advanced = false;
      const advance = () => {
        if (advanced || gen !== genRef.current) return;
        advanced = true;
        run(i + 1);
      };

      utterance.onstart = () => { startedAtRef.current = Date.now(); };
      utterance.onend = advance;
      utterance.onerror = (e) => {
        // cancel() raises "interrupted"/"canceled"; those are ours, not faults.
        if (e.error && !['interrupted', 'canceled'].includes(e.error)) {
          setError(`Voice error: ${e.error}`);
          setStatus('idle');
          return;
        }
        if (gen === genRef.current) advance();
      };

      window.speechSynthesis.speak(utterance);
    };

    setError(null);
    setStatus('playing');
    // Seed the clock before yielding: the watchdog runs off startedAtRef, and
    // a stale value would read as overdue before the first utterance starts.
    startedAtRef.current = Date.now();
    // cancel() is asynchronous in Chrome; speaking in the same tick can drop
    // the utterance outright, so yield once before starting.
    window.speechSynthesis.cancel();
    setTimeout(() => run(startIndex), 20);
  }, []);

  const play = useCallback(() => {
    if (!supported) {
      setError('This browser has no speech synthesis. Try Chrome, Edge, or Safari.');
      return;
    }
    // Pressing Play inside the debounce window would otherwise start on stale
    // sentences and then be cancelled the moment the analysis caught up.
    if (text !== analysisText) {
      pendingPlayRef.current = true;
      setAnalysisText(text);
      return;
    }
    if (sentences.length === 0) return;

    if (status === 'paused') {
      window.speechSynthesis.resume();
      startedAtRef.current = Date.now() - subProgress * expectedMsRef.current;
      setStatus('playing');
      return;
    }
    if (status === 'playing') return;
    speakFrom(Math.max(0, Math.min(resumeIndexRef.current, sentences.length - 1)));
  }, [supported, text, analysisText, sentences.length, status, subProgress, speakFrom]);

  const pause = useCallback(() => {
    if (status !== 'playing') return;
    window.speechSynthesis.pause();
    setStatus('paused');
  }, [status]);

  const seekTo = useCallback((i) => {
    if (i < 0 || i >= sentences.length) return;
    resumeIndexRef.current = i;
    if (status === 'idle') {
      setCurrentIndex(i);
      setSubProgress(0);
      return;
    }
    speakFrom(i);
  }, [sentences.length, status, speakFrom]);

  const skip = useCallback((delta) => {
    const base = indexRef.current >= 0 ? indexRef.current : resumeIndexRef.current;
    const next = Math.max(0, Math.min(base + delta, sentences.length - 1));
    if (status === 'idle') {
      resumeIndexRef.current = next;
      setCurrentIndex(next);
    } else {
      speakFrom(next);
    }
  }, [sentences.length, status, speakFrom]);

  // Rate cannot change mid-utterance; restart the sentence at the new speed.
  const rateRef = useRef(rate);
  useEffect(() => {
    const changed = rateRef.current !== rate;
    rateRef.current = rate;
    if (changed && status === 'playing' && indexRef.current >= 0) speakFrom(indexRef.current);
  }, [rate, status, speakFrom]);

  // Same for a voice change while reading.
  const voiceRef = useRef(selectedVoiceId);
  useEffect(() => {
    const changed = voiceRef.current !== selectedVoiceId;
    voiceRef.current = selectedVoiceId;
    if (changed && status === 'playing' && indexRef.current >= 0) speakFrom(indexRef.current);
  }, [selectedVoiceId, status, speakFrom]);

  /* ── Progress ticker and stall watchdog ───────────────────────────── */

  useEffect(() => {
    if (status !== 'playing') return undefined;
    const id = setInterval(() => {
      const elapsed = Date.now() - startedAtRef.current;
      const expected = expectedMsRef.current || 1;
      setSubProgress(Math.min(elapsed / expected, 1));

      // Chrome both stalls long passages and, less often, drops an utterance
      // without firing onend or onerror. The first case still reports
      // speaking, so nudge it; the second reports nothing at all, and only
      // this timer can move the reader on.
      const overdue = elapsed > expected + STALL_GRACE_MS;
      if (!overdue) return;
      const synth = window.speechSynthesis;
      if (synth.speaking && !synth.paused) {
        synth.resume();
        if (elapsed > expected * 2 + STALL_GRACE_MS * 2) synth.cancel();
      } else if (!synth.speaking && !synth.pending && indexRef.current >= 0) {
        const next = indexRef.current + 1;
        if (next < settingsRef.current.sentences.length) speakFrom(next);
        else stop();
      }
    }, 250);
    return () => clearInterval(id);
  }, [status, speakFrom, stop]);

  useEffect(() => () => {
    if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel();
  }, []);

  // Editing the text invalidates any position we were holding.
  useEffect(() => {
    hardStop();
    indexRef.current = -1;
    resumeIndexRef.current = 0;
    setCurrentIndex(-1);
    setSubProgress(0);
    setStatus('idle');
  }, [analysisText, hardStop]);

  // Declared after the reset above so it runs second and survives it: a Play
  // pressed mid-edit starts as soon as the fresh sentences exist.
  useEffect(() => {
    if (!pendingPlayRef.current) return;
    pendingPlayRef.current = false;
    if (sentences.length > 0) speakFrom(0);
  }, [analysisText, sentences.length, speakFrom]);

  const progress = sentences.length
    ? Math.min(((currentIndex < 0 ? 0 : currentIndex) + subProgress) / sentences.length, 1)
    : 0;

  const currentSentence = currentIndex >= 0 ? sentences[currentIndex] : null;
  const currentSpoken = useMemo(
    () => (currentSentence ? spokenFor(currentSentence) : null),
    [currentSentence, spokenFor],
  );

  return {
    text, setText,
    sentences, wordCount, estimatedSeconds,
    status, currentIndex, progress, error, supported,
    voices, selectedVoiceId, selectedVoice, setSelectedVoiceId: chooseVoice,
    rate, setRate,
    decipher, setDecipher, decipherAvailable,
    detectedLanguage: detected,
    spokenFor, currentSpoken,
    play, pause, stop, seekTo, skip,
  };
}
