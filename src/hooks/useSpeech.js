import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { splitSentences, countWords } from '@/lib/sentences';
import { verbalizeSentence, SUPPORTED } from '@/lib/verbalize';
import { detectLanguage } from '@/lib/language';
import { ECHO_VOICES, DEFAULT_VOICE, VOICE_UNAVAILABLE, checkEchoVoice, createEchoPlayer, makeRenderer } from '@/lib/echoVoice';

export const SAMPLE_TEXT = `Invoice #INV-2026-0042 totals $12,480.75, due 2026-09-30.

It covers 3 units at $4,160.25 each, plus 14.5% tax and a $250 delivery fee. The serial on the crate reads A4-9920-XJ; the tracking number is 1Z999AA10123456784.

Questions go to ml@pharos-ai.ca or 514-555-0123 before 14:30 on weekdays. Payment terms run 30-45 days, and the warranty covers 2026-2029.`;

/**
 * Rough speaking rate in characters per second at rate 1.0. A typical
 * voice runs near 170 words per minute and an English word averages about six
 * characters with its space, so ~16 c/s. Used for the duration estimate and
 * for the stall watchdog's patience, which is why it errs slightly slow.
 */
const CHARS_PER_SECOND = 16;

export function useSpeech() {
  const [text, setText] = useState('');
  const [analysisText, setAnalysisText] = useState('');
  const [selectedVoiceId, setSelectedVoiceId] = useState(DEFAULT_VOICE);
  const [status, setStatus] = useState('idle'); // idle | buffering | playing | paused
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [rate, setRate] = useState(1);
  const [decipher, setDecipher] = useState(true);
  const [subProgress, setSubProgress] = useState(0);
  const [error, setError] = useState(null);
  // Fail closed: until the Worker says the voice is ready, ECHO is silent.
  const [voiceStatus, setVoiceStatus] = useState('checking'); // checking | ready | unavailable
  const supported = voiceStatus === 'ready';
  const playerRef = useRef(null);
  if (!playerRef.current) playerRef.current = createEchoPlayer();

  const genRef = useRef(0);
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

  const voices = ECHO_VOICES;
  const selectedVoice = voices.find((v) => v.id === selectedVoiceId) || voices[0];
  const chooseVoice = useCallback((id) => {
    if (voices.some((v) => v.id === id)) setSelectedVoiceId(id);
  }, [voices]);

  const refreshVoice = useCallback(async () => {
    setVoiceStatus('checking');
    try {
      await checkEchoVoice();
      setVoiceStatus('ready');
      setError(null);
    } catch {
      setVoiceStatus('unavailable');
      setError(VOICE_UNAVAILABLE);
    }
  }, []);
  useEffect(() => { refreshVoice(); }, [refreshVoice]);

  /* ── Playback ─────────────────────────────────────────────────────── */

  const estimatedSeconds = useMemo(
    () => Math.ceil((analysisText.length / CHARS_PER_SECOND) / (rate || 1)),
    [analysisText.length, rate],
  );

  const hardStop = useCallback(() => {
    genRef.current++;
    playerRef.current.cancel();
  }, []);

  const stop = useCallback(() => {
    pendingPlayRef.current = false;
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
  settingsRef.current = { rate, selectedVoice, sentences, spokenFor, langCode, render: makeRenderer(selectedVoice.id, langCode) };

  const speakFrom = useCallback((startIndex) => {
    hardStop();
    const gen = genRef.current;
    setError(null);
    playerRef.current.start(startIndex, settingsRef, {
      onSentence(i) {
        if (gen !== genRef.current) return;
        indexRef.current = i; resumeIndexRef.current = i;
        setCurrentIndex(i); setSubProgress(0);
      },
      onStatus(value) { if (gen === genRef.current) setStatus(value); },
      onError() {
        if (gen !== genRef.current) return;
        setError(VOICE_UNAVAILABLE); setVoiceStatus('unavailable'); setStatus('idle');
      },
      onEnd() {
        if (gen !== genRef.current) return;
        indexRef.current = -1; resumeIndexRef.current = 0;
        setCurrentIndex(-1); setSubProgress(0); setStatus('idle');
      },
    });
  }, [hardStop]);

  const play = useCallback(() => {
    if (!supported) {
      setError(VOICE_UNAVAILABLE);
      refreshVoice();
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
      playerRef.current.resume();
      return;
    }
    if (status === 'playing' || status === 'buffering') return;
    speakFrom(Math.max(0, Math.min(resumeIndexRef.current, sentences.length - 1)));
  }, [supported, refreshVoice, text, analysisText, sentences.length, status, speakFrom]);

  const pause = useCallback(() => {
    if (!['playing', 'buffering'].includes(status)) return;
    playerRef.current.pause();
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
    if (changed && ['playing', 'buffering'].includes(status) && indexRef.current >= 0) speakFrom(indexRef.current);
  }, [rate, status, speakFrom]);

  // Same for a voice change while reading.
  const voiceRef = useRef(selectedVoiceId);
  useEffect(() => {
    const changed = voiceRef.current !== selectedVoiceId;
    voiceRef.current = selectedVoiceId;
    if (changed && status === 'paused') stop();
    if (changed && ['playing', 'buffering'].includes(status) && indexRef.current >= 0) speakFrom(indexRef.current);
  }, [selectedVoiceId, status, speakFrom, stop]);

  /* ── Progress ticker ──────────────────────────────────────────────── */

  useEffect(() => {
    if (status !== 'playing') return undefined;
    const id = setInterval(() => setSubProgress(playerRef.current.progress()), 250);
    return () => clearInterval(id);
  }, [status]);

  useEffect(() => () => { playerRef.current.dispose(); }, []);

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
    voiceStatus, refreshVoice,
    rate, setRate,
    decipher, setDecipher, decipherAvailable,
    detectedLanguage: detected,
    spokenFor, currentSpoken,
    play, pause, stop, seekTo, skip,
  };
}
