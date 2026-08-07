/**
 * Hardline readback: browser speechSynthesis + online /api/echo-tts playback.
 */

import {
  TTS_ENDPOINT,
  ONLINE_TTS_MAX_CHARS,
  ONLINE_TTS_VOICE,
  CLONE_VOICE_IDS,
} from './config.js';
import { findProfile } from './profiles.js';
import { normalizeText, prepareTtsText, chunkTextForPlayback, clampNumber } from './text.js';

/**
 * @param {object} api shared app surface
 */
export function createPlaybackController(api) {
  const {
    synth,
    voiceSelect,
    rateInput,
    pitchInput,
    volumeInput,
    textArea,
    setStatus,
    setProgress,
    setButtons,
    setPlaybackActive,
    getActiveProfileId,
    getAvailableVoices,
    renderPreviewSurface,
    clearHighlights,
    highlightWord,
    getStopSamplePreview,
  } = api;

  let playbackChunks = [];
  let playbackChunkIndex = 0;
  let playbackSessionId = 0;
  let activeUtterance = null;
  let onlineAudio = null;
  let onlineObjectUrl = null;
  let onlineNormalizedText = '';
  let playing = false;
  let paused = false;

  const stopOnlineAudio = () => {
    if (onlineAudio) {
      try {
        onlineAudio.pause();
        onlineAudio.removeAttribute('src');
        onlineAudio.load();
      } catch {
        // best-effort
      }
      onlineAudio = null;
    }
    if (onlineObjectUrl) {
      try {
        URL.revokeObjectURL(onlineObjectUrl);
      } catch {
        // best-effort
      }
      onlineObjectUrl = null;
    }
    onlineNormalizedText = '';
  };

  const stopPlayback = (resetStatus = true) => {
    playbackSessionId += 1;
    playbackChunks = [];
    playbackChunkIndex = 0;
    activeUtterance = null;
    playing = false;
    paused = false;
    if (synth) {
      synth.cancel();
    }
    stopOnlineAudio();
    clearHighlights();
    lastHighlightScrollAt = 0;
    setPlaybackActive(false);
    if (resetStatus) {
      setStatus('Idle. Press Play to start reading.', 'info');
      setProgress(0, 'Idle');
    }
    setButtons();
  };

  const onPlaybackBoundary = (globalCharIndex, fullTextLength) => {
    const ratio = fullTextLength ? (globalCharIndex / fullTextLength) * 100 : 0;
    setProgress(ratio, `Reading chunk ${playbackChunkIndex + 1}/${playbackChunks.length}`);
    highlightWord(globalCharIndex);
  };

  const getSelectedVoice = () => {
    return getAvailableVoices().find((entry) => entry.voiceURI === voiceSelect.value) || null;
  };

  const startChunkPlayback = (sessionId, normalizedText) => {
    if (sessionId !== playbackSessionId) {
      return;
    }

    if (playbackChunkIndex >= playbackChunks.length) {
      playing = false;
      paused = false;
      activeUtterance = null;
      setPlaybackActive(false);
      setProgress(100, 'Complete');
      setStatus('Reading finished.', 'ok');
      setButtons();
      return;
    }

    const chunk = playbackChunks[playbackChunkIndex];
    const utterance = new window.SpeechSynthesisUtterance(prepareTtsText(chunk.text));
    const selectedVoice = getSelectedVoice();
    if (selectedVoice) {
      utterance.voice = selectedVoice;
      utterance.lang = selectedVoice.lang;
    }
    utterance.rate = clampNumber(rateInput.value, 0.6, 1.6, 1);
    utterance.pitch = clampNumber(pitchInput.value, 0.6, 1.5, 1);
    utterance.volume = clampNumber(volumeInput.value, 0.1, 1, 1);

    utterance.onstart = () => {
      if (sessionId !== playbackSessionId) {
        return;
      }
      playing = true;
      paused = false;
      activeUtterance = utterance;
      setPlaybackActive(true);
      setStatus(`Reading with ${findProfile(getActiveProfileId()).label}.`, 'ok');
      setButtons();
    };

    utterance.onboundary = (event) => {
      if (sessionId !== playbackSessionId || typeof event.charIndex !== 'number') {
        return;
      }
      onPlaybackBoundary(chunk.start + event.charIndex, normalizedText.length);
    };

    utterance.onerror = (event) => {
      if (sessionId !== playbackSessionId) {
        return;
      }
      playing = false;
      paused = false;
      activeUtterance = null;
      setPlaybackActive(false);
      setStatus(`Speech synthesis error: ${event.error || 'unknown error'}.`, 'error');
      setButtons();
    };

    utterance.onend = () => {
      if (sessionId !== playbackSessionId) {
        return;
      }
      playbackChunkIndex += 1;
      if (playbackChunkIndex < playbackChunks.length) {
        window.setTimeout(() => startChunkPlayback(sessionId, normalizedText), 250);
      } else {
        playing = false;
        paused = false;
        activeUtterance = null;
        setPlaybackActive(false);
        setProgress(100, 'Complete');
        setStatus('Reading finished.', 'ok');
        setButtons();
      }
    };

    synth.speak(utterance);
  };

  const startOnlinePlayback = async (sessionId, normalizedText) => {
    const spokenSource = prepareTtsText(normalizedText);
    const spoken =
      spokenSource.length > ONLINE_TTS_MAX_CHARS
        ? spokenSource.slice(0, ONLINE_TTS_MAX_CHARS)
        : spokenSource;
    if (spokenSource.length > ONLINE_TTS_MAX_CHARS) {
      setStatus(
        `Draft truncated to ${ONLINE_TTS_MAX_CHARS.toLocaleString()} characters for Workers AI readback.`,
        'info',
      );
    }
    const profile = findProfile(getActiveProfileId());
    const voiceId = profile.onlineVoiceId || getActiveProfileId() || ONLINE_TTS_VOICE;
    setStatus(`Synthesizing with ${profile.label}…`, 'info');
    setProgress(0, 'Synthesizing...');

    const speed = clampNumber(rateInput.value, 0.6, 1.6, 1);
    const response = await fetch(TTS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: spoken,
        voice: voiceId,
        voiceId,
        voice_id: voiceId,
        speed,
        format: 'mp3',
        filename: 'echo-readback.mp3',
      }),
    });

    if (sessionId !== playbackSessionId) {
      return;
    }

    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try {
        const errBody = await response.json();
        detail = errBody?.error || errBody?.detail || detail;
      } catch {
        // ignore
      }
      throw new Error(String(detail));
    }

    const blob = await response.blob();
    if (sessionId !== playbackSessionId) {
      return;
    }
    if (!blob.size) {
      throw new Error('Workers AI returned empty audio.');
    }

    stopOnlineAudio();
    onlineObjectUrl = URL.createObjectURL(blob);
    onlineNormalizedText = normalizedText;
    const audio = new Audio(onlineObjectUrl);
    audio.preload = 'auto';
    onlineAudio = audio;

    audio.addEventListener('timeupdate', () => {
      if (sessionId !== playbackSessionId || !audio.duration) {
        return;
      }
      const ratio = Math.min(1, audio.currentTime / audio.duration);
      setProgress(ratio * 100, `Reading (${findProfile(getActiveProfileId()).label})`);
      const charIndex = Math.min(
        Math.floor(ratio * normalizedText.length),
        Math.max(0, normalizedText.length - 1),
      );
      highlightWord(charIndex);
    });

    audio.addEventListener('ended', () => {
      if (sessionId !== playbackSessionId) {
        return;
      }
      playing = false;
      paused = false;
      setPlaybackActive(false);
      setProgress(100, 'Complete');
      setStatus('Reading finished.', 'ok');
      setButtons();
    });

    audio.addEventListener('error', () => {
      if (sessionId !== playbackSessionId) {
        return;
      }
      playing = false;
      paused = false;
      setPlaybackActive(false);
      setStatus('Audio playback failed in this browser.', 'error');
      setButtons();
    });

    await audio.play();
    if (sessionId !== playbackSessionId) {
      return;
    }
    playing = true;
    paused = false;
    setPlaybackActive(true);
    setStatus(`Reading with ${findProfile(getActiveProfileId()).label}.`, 'ok');
    setButtons();
  };

  const startPlayback = async () => {
    // Stop static voice samples when starting live readback.
    try {
      const stopSamplePreview = getStopSamplePreview?.();
      if (typeof stopSamplePreview === 'function') {
        stopSamplePreview();
      }
    } catch {
      // samples may not be wired yet during early init
    }

    const useOnlineEcho = CLONE_VOICE_IDS.has(getActiveProfileId());

    if (paused && onlineAudio && useOnlineEcho) {
      try {
        await onlineAudio.play();
        paused = false;
        playing = true;
        setPlaybackActive(true);
        setStatus('Reading resumed.', 'ok');
        setButtons();
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Could not resume audio.', 'error');
      }
      return;
    }

    if (paused && activeUtterance && synth) {
      synth.resume();
      paused = false;
      playing = true;
      setPlaybackActive(true);
      setStatus('Reading resumed.', 'ok');
      setButtons();
      return;
    }

    const normalizedText = normalizeText(textArea.value);
    if (!normalizedText) {
      setStatus('Paste text or import a file before pressing Play.', 'error');
      return;
    }

    if (!useOnlineEcho) {
      if (!synth || typeof window.SpeechSynthesisUtterance !== 'function') {
        setStatus('This browser does not support speech synthesis on this route.', 'error');
        return;
      }
      if (!getAvailableVoices().length) {
        setStatus('The browser has not exposed any system voices yet. Wait a moment and try again.', 'error');
        return;
      }
    }

    stopPlayback(false);
    playbackChunks = chunkTextForPlayback(normalizedText);
    playbackChunkIndex = 0;
    playbackSessionId += 1;
    const sessionId = playbackSessionId;
    setButtons();

    const didRender = await renderPreviewSurface(normalizedText);
    if (!didRender || normalizeText(textArea.value) !== normalizedText) {
      setStatus('Text changed while preparing the reading surface. Press Play again.', 'info');
      setProgress(0, 'Edited');
      setButtons();
      return;
    }

    clearHighlights();

    if (useOnlineEcho) {
      try {
        await startOnlinePlayback(sessionId, normalizedText);
      } catch (error) {
        if (sessionId !== playbackSessionId) {
          return;
        }
        const message = error instanceof Error ? error.message : 'Online readback failed.';
        setStatus(`${message} Falling back to system voices when available.`, 'error');
        if (synth && getAvailableVoices().length) {
          setProgress(0, `Preparing ${playbackChunks.length} chunk(s)...`);
          setStatus('Starting browser playback (fallback)...', 'info');
          startChunkPlayback(sessionId, normalizedText);
        } else {
          setButtons();
        }
      }
      return;
    }

    setProgress(0, `Preparing ${playbackChunks.length} chunk(s)...`);
    setStatus('Starting browser playback...', 'info');
    startChunkPlayback(sessionId, normalizedText);
  };


  const pause = () => {
    if (!playing || paused) {
      return;
    }
    if (onlineAudio) {
      onlineAudio.pause();
      paused = true;
      playing = true;
      setPlaybackActive(false);
      setStatus('Reading paused.', 'info');
      setButtons();
      return;
    }
    if (!synth) {
      return;
    }
    synth.pause();
    paused = true;
    playing = true;
    setPlaybackActive(false);
    setStatus('Reading paused.', 'info');
    setButtons();
  };

  return {
    stopPlayback,
    startPlayback,
    pause,
    get playing() {
      return playing;
    },
    get paused() {
      return paused;
    },
  };
}
