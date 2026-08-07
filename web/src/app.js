/**
 * Hardline ECHO reader — DOM wiring shell.
 * Playback: ./playback.js · Dictation: ./dictation.js
 */
import {
  SAMPLE_TEXT,
  VOICE_POLL_INTERVAL_MS,
  VOICE_POLL_MAX_ATTEMPTS,
  PREVIEW_RENDER_DEBOUNCE_MS,
  DEFAULT_SURFACE_BATCH_SIZE,
  LARGE_SURFACE_BATCH_SIZE,
  LARGE_DRAFT_WORD_THRESHOLD,
  HIGHLIGHT_SCROLL_THROTTLE_MS,
  SYSTEM_PROFILE_ID,
  CLONE_VOICE_IDS,
  ECHO_PROFILE_SUMMARY,
} from './config.js';
import {
  PROFILE_CATALOG,
  findProfile,
  profileFromQuery,
  persistQueryProfile,
} from './profiles.js';
import {
  normalizeText,
  clampNumber,
  countWords,
  estimateMinutes,
  formatMinutes,
} from './text.js';
import {
  loadStoredState,
  storeState,
  clearStoredDraftText,
} from './state.js';
import { extractTextFromFile } from './files.js';
import {
  buildWaveformBars,
  setWaveformActive,
  renderWordSurface,
  findWordIndexForChar,
} from './surface.js';
import {
  chooseVoiceForProfile,
  formatVoiceMeta,
  safeFileMeta,
  setVoiceSelectPlaceholder,
} from './browser-voices.js';
import { createDictationController } from './dictation.js';
import { createPlaybackController } from './playback.js';

export function initEchoReaderApp() {
  const appNode = document.querySelector('[data-echo-app]');
  if (!appNode) {
    console.error('[ECHO] init aborted: [data-echo-app] not found');
    return;
  }

  const synth = window.speechSynthesis;
  const dropZone = appNode.querySelector('[data-echo-dropzone]');
  const fileInput = appNode.querySelector('[data-echo-file-input]');
  const fileMetaNode = appNode.querySelector('[data-echo-file-meta]');
  const textMetaNode = appNode.querySelector('[data-echo-text-meta]');
  const textArea = appNode.querySelector('[data-echo-text]');
  const keepDraftInput = appNode.querySelector('[data-echo-keep-draft]');
  const sampleButton = appNode.querySelector('[data-echo-sample]');
  const clearButton = appNode.querySelector('[data-echo-clear]');
  const voiceSelect = appNode.querySelector('[data-echo-voice]');
  const voiceMetaNode = appNode.querySelector('[data-echo-voice-meta]');
  const profileCopyNode = appNode.querySelector('[data-echo-profile-copy]');
  const profileButtons = Array.from(appNode.querySelectorAll('[data-echo-profile]'));
  const rateInput = appNode.querySelector('[data-echo-rate]');
  const pitchInput = appNode.querySelector('[data-echo-pitch]');
  const volumeInput = appNode.querySelector('[data-echo-volume]');
  const rateValueNode = appNode.querySelector('[data-echo-rate-value]');
  const pitchValueNode = appNode.querySelector('[data-echo-pitch-value]');
  const volumeValueNode = appNode.querySelector('[data-echo-volume-value]');
  const waveformNode = appNode.querySelector('[data-echo-waveform]');
  const allWaveformNodes = Array.from(appNode.querySelectorAll('[data-echo-waveform]'));
  const speakerNode = appNode.querySelector('[data-echo-speaker]');
  const readyBadgeNode = appNode.querySelector('.echo-header-ready');
  const setPlaybackActive = (active) => {
    allWaveformNodes.forEach((wn) => setWaveformActive(wn, active));
    if (speakerNode) speakerNode.classList.toggle('is-active', active);
  };
  const playButton = appNode.querySelector('[data-echo-play]');
  const pauseButton = appNode.querySelector('[data-echo-pause]');
  const stopButton = appNode.querySelector('[data-echo-stop]');
  const statusNode = appNode.querySelector('[data-echo-status]');
  const progressNode = appNode.querySelector('[data-echo-progress]');
  const progressLabelNode = appNode.querySelector('[data-echo-progress-label]');
  const outputNode = appNode.querySelector('[data-echo-output]');
  const recordButton = appNode.querySelector('[data-echo-record]');
  const importAudioButton = appNode.querySelector('[data-echo-audio-load]');
  const audioInput = appNode.querySelector('[data-echo-audio-input]');
  const stopRecordButton = appNode.querySelector('[data-echo-record-stop]');
  const regenerateTranscriptButton = appNode.querySelector('[data-echo-transcript-regenerate]');
  const clearTranscriptButton = appNode.querySelector('[data-echo-transcript-clear]');
  const downloadTranscriptButton = appNode.querySelector('[data-echo-transcript-download]');
  const dictationStatusNode = appNode.querySelector('[data-echo-dictation-status]');
  const dictationMetaNode = appNode.querySelector('[data-echo-dictation-meta]');
  const dictationDurationNode = appNode.querySelector('[data-echo-dictation-duration]');
  const dictationOutputNode = appNode.querySelector('[data-echo-dictation-output]');

  const missingNodes = Object.entries({
    dropZone,
    fileInput,
    fileMetaNode,
    textMetaNode,
    textArea,
    keepDraftInput,
    sampleButton,
    clearButton,
    voiceSelect,
    voiceMetaNode,
    profileCopyNode,
    rateInput,
    pitchInput,
    volumeInput,
    rateValueNode,
    pitchValueNode,
    volumeValueNode,
    waveformNode,
    playButton,
    pauseButton,
    stopButton,
    statusNode,
    progressNode,
    progressLabelNode,
    outputNode,
  })
    .filter(([, node]) => !node)
    .map(([name]) => name);

  if (missingNodes.length) {
    const message = `[ECHO] init aborted: missing ${missingNodes.join(', ')}`;
    console.error(message);
    const readyBadge = appNode.querySelector('.echo-header-ready');
    if (readyBadge) {
      readyBadge.textContent = 'Init failed';
    }
    if (statusNode) {
      statusNode.hidden = false;
      statusNode.setAttribute('aria-hidden', 'false');
      statusNode.textContent = message;
      statusNode.dataset.tone = 'error';
    }
    return;
  }

  allWaveformNodes.forEach((n) => buildWaveformBars(n));

  const storedState = loadStoredState();
  const queryProfile = profileFromQuery();
  let activeProfileId = queryProfile || storedState?.profileId || PROFILE_CATALOG[0].id;
  let keepDraftOnDevice = storedState?.keepDraft === true;
  let availableVoices = [];
  let wordRanges = [];
  let highlightedWordIndex = -1;
  let extracting = false;
  let previewRenderTimer = 0;
  let previewRenderVersion = 0;
  let voicePollTimer = 0;
  let voicePollAttempts = 0;
  let lastHighlightScrollAt = 0;
  const dictationEnabled = Boolean(
    recordButton &&
    stopRecordButton &&
    regenerateTranscriptButton &&
    clearTranscriptButton &&
    downloadTranscriptButton &&
    dictationStatusNode &&
    dictationMetaNode &&
    dictationDurationNode &&
    dictationOutputNode
  );
  const audioImportEnabled = Boolean(importAudioButton && audioInput);

  const setStatus = (message, tone = 'info') => {
    const text = String(message || '').trim();
    statusNode.textContent = text;
    statusNode.dataset.tone = tone;
    // Status is hidden in the static shell; show it whenever there is copy.
    statusNode.hidden = !text;
    statusNode.setAttribute('aria-hidden', text ? 'false' : 'true');
  };

  const setProgress = (percent, label) => {
    const clamped = Math.max(0, Math.min(100, Math.round(percent)));
    progressNode.style.width = `${clamped}%`;
    progressLabelNode.textContent = label;
  };

  const syncReadyBadge = () => {
    if (!readyBadgeNode) {
      return;
    }

    const onlineEcho = CLONE_VOICE_IDS.has(activeProfileId);
    const ready = onlineEcho
      ? true
      : Boolean(synth && typeof window.SpeechSynthesisUtterance === 'function' && availableVoices.length);
    readyBadgeNode.classList.toggle('is-ready', ready);
    readyBadgeNode.classList.toggle('is-idle', !ready);
    readyBadgeNode.textContent = ready ? 'Ready' : 'Waiting';
  };

  const setButtons = () => {
    const hasText = normalizeText(textArea.value).length > 0;
    const onlineEcho = CLONE_VOICE_IDS.has(activeProfileId);
    const speechUnavailable =
      !onlineEcho && (!synth || typeof window.SpeechSynthesisUtterance !== 'function');
    const voicesUnavailable = !onlineEcho && !availableVoices.length;
    const playing = playback?.playing;
    const paused = playback?.paused;

    playButton.disabled = speechUnavailable || voicesUnavailable || extracting || !hasText || (playing && !paused);
    pauseButton.disabled = speechUnavailable || !playing || paused;
    stopButton.disabled = speechUnavailable || (!playing && !paused);
    playButton.textContent = '▶';
    playButton.setAttribute('aria-label', paused ? 'Resume' : 'Play');
    pauseButton.textContent = '❚❚';
    pauseButton.setAttribute('aria-label', 'Pause');
    stopButton.textContent = '■';
    stopButton.setAttribute('aria-label', 'Stop');
    dictation?.setDictationButtons();
    syncReadyBadge();
  };

  const clearHighlights = () => {
    if (highlightedWordIndex >= 0 && wordRanges[highlightedWordIndex]) {
      wordRanges[highlightedWordIndex].node.classList.remove('is-active');
      wordRanges[highlightedWordIndex].node.classList.remove('was-active');
    }
    highlightedWordIndex = -1;
  };

  const shouldScrollHighlightedWord = (node) => {
    const now = Date.now();
    if (now - lastHighlightScrollAt < HIGHLIGHT_SCROLL_THROTTLE_MS) {
      return false;
    }

    const containerRect = outputNode.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    const visibleTop = containerRect.top + 18;
    const visibleBottom = containerRect.bottom - 18;
    return nodeRect.top < visibleTop || nodeRect.bottom > visibleBottom;
  };

  const highlightWord = (charIndex) => {
    if (!wordRanges.length) {
      return;
    }

    const nextIndex = findWordIndexForChar(wordRanges, charIndex);
    if (nextIndex === highlightedWordIndex || nextIndex < 0) {
      return;
    }

    // trail the previous word briefly
    if (highlightedWordIndex >= 0 && wordRanges[highlightedWordIndex]) {
      const prevNode = wordRanges[highlightedWordIndex].node;
      prevNode.classList.remove('is-active');
      prevNode.classList.add('was-active');
      setTimeout(() => prevNode.classList.remove('was-active'), 800);
    }
    highlightedWordIndex = -1;

    const target = wordRanges[nextIndex];
    target.node.classList.add('is-active');
    if (shouldScrollHighlightedWord(target.node)) {
      target.node.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      lastHighlightScrollAt = Date.now();
    }
    highlightedWordIndex = nextIndex;
  };

  const updateTextMeta = () => {
    const normalized = normalizeText(textArea.value);
    textMetaNode.textContent = `${countWords(normalized).toLocaleString()} words · ${normalized.length.toLocaleString()} chars · ${formatMinutes(
      estimateMinutes(normalized, clampNumber(rateInput.value, 0.6, 1.6, 1)),
    )}`;
  };

  const syncSliderLabels = () => {
    rateValueNode.textContent = clampNumber(rateInput.value, 0.6, 1.6, 1).toFixed(2);
    pitchValueNode.textContent = clampNumber(pitchInput.value, 0.6, 1.5, 1).toFixed(2);
    volumeValueNode.textContent = clampNumber(volumeInput.value, 0.1, 1, 1).toFixed(2);
    updateTextMeta();
  };

  const persistState = () => {
    storeState({
      ...(keepDraftOnDevice ? { text: textArea.value } : {}),
      keepDraft: keepDraftOnDevice,
      profileId: activeProfileId,
      voiceUri: voiceSelect.value,
      rate: clampNumber(rateInput.value, 0.6, 1.6, 1),
      pitch: clampNumber(pitchInput.value, 0.6, 1.5, 1),
      volume: clampNumber(volumeInput.value, 0.1, 1, 1),
    });
  };

  const clearDraftOnClose = () => {
    if (!keepDraftOnDevice) {
      clearStoredDraftText();
    }
  };

  const renderPreviewSurface = async (text) => {
    const normalized = normalizeText(text);
    const renderVersion = ++previewRenderVersion;
    const wordCount = countWords(normalized);
    const batchSize = wordCount >= LARGE_DRAFT_WORD_THRESHOLD
      ? LARGE_SURFACE_BATCH_SIZE
      : DEFAULT_SURFACE_BATCH_SIZE;

    const nextWordRanges = await renderWordSurface(outputNode, normalized, {
      batchSize,
      isStale: () => renderVersion !== previewRenderVersion,
    });

    if (!nextWordRanges || renderVersion !== previewRenderVersion) {
      return false;
    }

    wordRanges = nextWordRanges;
    highlightedWordIndex = -1;
    lastHighlightScrollAt = 0;
    return true;
  };

  const schedulePreviewRender = () => {
    window.clearTimeout(previewRenderTimer);
    previewRenderTimer = window.setTimeout(() => {
      void renderPreviewSurface(textArea.value);
    }, PREVIEW_RENDER_DEBOUNCE_MS);
  };


  let dictation;
  let playback;
  let stopSamplePreviewRef = null;

  dictation = createDictationController({
    dictationEnabled,
    audioImportEnabled,
    recordButton,
    importAudioButton,
    audioInput,
    stopRecordButton,
    regenerateTranscriptButton,
    clearTranscriptButton,
    downloadTranscriptButton,
    dictationStatusNode,
    dictationMetaNode,
    dictationDurationNode,
    dictationOutputNode,
    textArea,
    fileMetaNode,
    setButtons: () => setButtons(),
    setStatus,
    setProgress,
    updateTextMeta,
    renderPreviewSurface,
    persistState,
  });

  playback = createPlaybackController({
    synth,
    voiceSelect,
    rateInput,
    pitchInput,
    volumeInput,
    textArea,
    setStatus,
    setProgress,
    setButtons: () => setButtons(),
    setPlaybackActive,
    getActiveProfileId: () => activeProfileId,
    getAvailableVoices: () => availableVoices,
    renderPreviewSurface,
    clearHighlights,
    highlightWord,
    getStopSamplePreview: () => stopSamplePreviewRef,
  });

  const refreshVoiceMeta = () => {
    const voice = availableVoices.find((entry) => entry.voiceURI === voiceSelect.value) || null;
    const isSystemMode = activeProfileId === 'system';
    voiceMetaNode.textContent = isSystemMode
      ? formatVoiceMeta(voice, availableVoices.length)
      : (voice ? voice.name : '');
  };

  const clearVoicePolling = () => {
    if (voicePollTimer) {
      window.clearInterval(voicePollTimer);
      voicePollTimer = 0;
    }
    voicePollAttempts = 0;
  };

  const applyProfile = (profileId, updateVoiceSelection = true) => {
    const profile = findProfile(profileId);
    activeProfileId = profile.id;
    profileCopyNode.textContent = ECHO_PROFILE_SUMMARY;

    profileButtons.forEach((button) => {
      button.classList.toggle('is-active', button.dataset.echoProfile === profile.id);
    });

    rateInput.value = profile.rate.toFixed(2);
    pitchInput.value = profile.pitch.toFixed(2);
    volumeInput.value = profile.volume.toFixed(2);
    syncSliderLabels();

    const isSystemMode = profile.id === SYSTEM_PROFILE_ID;
    voiceSelect.closest('.echo-header-profiles')?.classList.toggle('echo-system-mode', isSystemMode);

    if (!isSystemMode && updateVoiceSelection && availableVoices.length) {
      const nextVoice = chooseVoiceForProfile(availableVoices, profile.id);
      if (nextVoice) {
        voiceSelect.value = nextVoice.voiceURI;
      }
    }

    refreshVoiceMeta();
    persistQueryProfile(profile.id);
    persistState();
  };

  const onFileSelected = async (file) => {
    playback.stopPlayback(false);
    extracting = true;
    setButtons();
    setStatus(`Reading ${file.name}...`, 'info');
    setProgress(0, 'Importing file...');

    try {
      const extractedText = await extractTextFromFile(file, setStatus);
      if (!extractedText) {
        throw new Error('No readable text was found in this file.');
      }

      textArea.value = extractedText;
      fileMetaNode.textContent = safeFileMeta(file, extractedText);
      updateTextMeta();
      await renderPreviewSurface(extractedText);
      setStatus('File imported. Adjust the voice and press Play.', 'ok');
      setProgress(0, 'Ready');
      persistState();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'File import failed.';
      textArea.value = '';
      fileMetaNode.textContent = file ? file.name : 'No file selected yet.';
      updateTextMeta();
      await renderPreviewSurface('');
      setStatus(message, 'error');
      setProgress(0, 'Import failed');
    } finally {
      extracting = false;
      setButtons();
      fileInput.value = '';
    }
  };

  const populateVoices = (preserveSelection = true) => {
    if (!synth) {
      availableVoices = [];
      setVoiceSelectPlaceholder(voiceSelect, 'Speech synthesis unavailable');
      refreshVoiceMeta();
      setButtons();
      return false;
    }

    const voices = synth.getVoices();
    if (!voices.length) {
      availableVoices = [];
      setVoiceSelectPlaceholder(voiceSelect, 'Waiting for system voices...');
      refreshVoiceMeta();
      setButtons();
      return false;
    }

    const hadNoVoices = !availableVoices.length || voiceSelect.disabled;
    const previousValue = preserveSelection ? voiceSelect.value || storedState?.voiceUri || '' : '';
    availableVoices = [...voices].sort((left, right) => {
      const leftName = `${left.lang} ${left.name}`.toLowerCase();
      const rightName = `${right.lang} ${right.name}`.toLowerCase();
      return leftName.localeCompare(rightName);
    });

    voiceSelect.disabled = false;
    voiceSelect.innerHTML = '';
    availableVoices.forEach((voice) => {
      const option = document.createElement('option');
      option.value = voice.voiceURI;
      option.textContent = `${voice.name} · ${voice.lang || 'unknown'}`;
      voiceSelect.append(option);
    });

    const hasPrevious = previousValue && availableVoices.some((voice) => voice.voiceURI === previousValue);
    if (hasPrevious) {
      voiceSelect.value = previousValue;
    } else {
      const nextVoice = chooseVoiceForProfile(availableVoices, activeProfileId);
      if (nextVoice) {
        voiceSelect.value = nextVoice.voiceURI;
      }
    }

    refreshVoiceMeta();
    persistState();
    setButtons();
    if (hadNoVoices && !playback?.playing && !playback?.paused && !extracting) {
      setStatus('', 'ok');
      setProgress(0, 'Ready');
    }
    return true;
  };

  const startVoicePolling = () => {
    clearVoicePolling();
    if (populateVoices(true)) {
      return;
    }

    setStatus('Waiting for browser/system voices to load...', 'info');
    setProgress(0, 'Voice scan');

    voicePollTimer = window.setInterval(() => {
      voicePollAttempts += 1;
      if (populateVoices(true) || voicePollAttempts >= VOICE_POLL_MAX_ATTEMPTS) {
        clearVoicePolling();
        if (!availableVoices.length && !playback?.playing && !playback?.paused && !extracting) {
          setStatus('System voices are not available yet on this device or browser.', 'info');
          setProgress(0, 'Voice unavailable');
        }
      }
    }, VOICE_POLL_INTERVAL_MS);
  };

  keepDraftInput.checked = keepDraftOnDevice;
  if (!keepDraftOnDevice) {
    clearStoredDraftText();
  }

  textArea.value = keepDraftOnDevice && typeof storedState?.text === 'string' ? storedState.text : SAMPLE_TEXT;
  rateInput.value = clampNumber(storedState?.rate, 0.6, 1.6, 1).toFixed(2);
  pitchInput.value = clampNumber(storedState?.pitch, 0.6, 1.5, 1).toFixed(2);
  volumeInput.value = clampNumber(storedState?.volume, 0.1, 1, 1).toFixed(2);

  syncSliderLabels();
  fileMetaNode.textContent = 'No file selected yet.';
  void renderPreviewSurface(textArea.value);
  renderDictationOutput();
  updateDictationDuration(0);
  if (dictationEnabled) {
    setDictationStatus('Microphone idle.', 'info');
    setDictationMeta('Capture a clip to render transcript text here.');
  }
  applyProfile(activeProfileId, false);
  if (!queryProfile && storedState) {
    rateInput.value = clampNumber(storedState.rate, 0.6, 1.6, 1).toFixed(2);
    pitchInput.value = clampNumber(storedState.pitch, 0.6, 1.5, 1).toFixed(2);
    volumeInput.value = clampNumber(storedState.volume, 0.1, 1, 1).toFixed(2);
    syncSliderLabels();
  }

  if (!synth || typeof window.SpeechSynthesisUtterance !== 'function') {
    setStatus('Speech synthesis is not available in this browser.', 'error');
    setVoiceSelectPlaceholder(voiceSelect, 'Speech synthesis unavailable');
    refreshVoiceMeta();
  } else if (populateVoices(true)) {
    setStatus('', 'info');
    setProgress(0, 'Idle');
  } else {
    startVoicePolling();
  }
  setButtons();

  const onVoicesChanged = () => {
    clearVoicePolling();
    populateVoices(true);
  };

  if (synth && typeof synth.addEventListener === 'function') {
    synth.addEventListener('voiceschanged', onVoicesChanged);
  } else if (synth && typeof synth.onvoiceschanged !== 'undefined') {
    synth.onvoiceschanged = onVoicesChanged;
  }

  // Static preview clips (no API). Hosted at /echo/voices/*.mp3
  let sampleAudio = null;
  const sampleButtons = Array.from(appNode.querySelectorAll('[data-echo-voice-sample]'));
  const sampleHintNode = appNode.querySelector('[data-echo-sample-hint]');

  const stopSamplePreview = () => {
    if (sampleAudio) {
      try {
        sampleAudio.pause();
        sampleAudio.removeAttribute('src');
        sampleAudio.load();
      } catch {
        // best-effort
      }
      sampleAudio = null;
    }
    sampleButtons.forEach((btn) => btn.classList.remove('is-playing'));
  };

  stopSamplePreviewRef = stopSamplePreview;

  const playSamplePreview = async (button) => {
    const src = button.dataset.sampleSrc || '';
    const label = button.dataset.sampleLabel || 'Sample';
    if (!src) {
      return;
    }

    if (button.classList.contains('is-playing') && sampleAudio) {
      stopSamplePreview();
      if (sampleHintNode) {
        sampleHintNode.textContent =
          'Select a voice, then Play to read your full draft. ▶ clips are short previews only.';
      }
      return;
    }

    stopSamplePreview();
    playback.stopPlayback(false);
    // Selecting a sample also selects that voice for full-draft live readaloud.
    const sampleId = button.dataset.sampleId || '';
    if (sampleId && CLONE_VOICE_IDS.has(sampleId)) {
      applyProfile(sampleId, true);
      setButtons();
    }
    const audio = new Audio(src);
    sampleAudio = audio;
    button.classList.add('is-playing');
    if (sampleHintNode) {
      sampleHintNode.textContent = `${label} selected · Play reads your full draft in this voice`;
    }
    setStatus(`${label} selected — paste a draft and press Play to hear the whole text.`, 'info');

    audio.addEventListener('ended', () => {
      stopSamplePreview();
      if (sampleHintNode) {
        sampleHintNode.textContent =
          'Select a voice, then Play to read your full draft. ▶ clips are short previews only.';
      }
    });
    audio.addEventListener('error', () => {
      stopSamplePreview();
      setStatus(`Could not load sample "${label}".`, 'error');
      if (sampleHintNode) {
        sampleHintNode.textContent = 'Sample failed to load.';
      }
    });

    try {
      await audio.play();
    } catch (error) {
      stopSamplePreview();
      setStatus(error instanceof Error ? error.message : 'Sample playback blocked.', 'error');
    }
  };

  sampleButtons.forEach((button) => {
    button.addEventListener('click', () => {
      void playSamplePreview(button);
    });
  });

  profileButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const profileId = button.dataset.echoProfile || PROFILE_CATALOG[0].id;
      stopSamplePreview();
      applyProfile(profileId, true);
      setButtons();

      if (CLONE_VOICE_IDS.has(profileId)) {
        if (normalizeText(textArea.value)) {
          void playback.startPlayback();
        } else {
          setStatus(`Paste text or import a file to read with ${findProfile(profileId).label}.`, 'info');
        }
      } else {
        setStatus(`Profile switched to ${findProfile(activeProfileId).label}.`, 'info');
      }
    });
  });

  [rateInput, pitchInput, volumeInput].forEach((input) => {
    input.addEventListener('input', () => {
      syncSliderLabels();
      persistState();
    });
  });

  voiceSelect.addEventListener('change', () => {
    refreshVoiceMeta();
    persistState();
  });

  keepDraftInput.addEventListener('change', () => {
    keepDraftOnDevice = keepDraftInput.checked;
    if (!keepDraftOnDevice) {
      clearStoredDraftText();
      setStatus('Draft persistence off. Text will clear when this page closes.', 'info');
    } else {
      setStatus('Draft persistence on for this device.', 'ok');
    }
    persistState();
  });

  textArea.addEventListener('input', () => {
    if (playback.playing || playback.paused) {
      playback.stopPlayback(false);
      setStatus('Text changed. Press Play to start a fresh pass.', 'info');
      setProgress(0, 'Edited');
    }
    fileMetaNode.textContent = 'Working from pasted or edited text.';
    updateTextMeta();
    schedulePreviewRender();
    persistState();
    setButtons();
  });

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    if (file) {
      await onFileSelected(file);
    }
  });

  dropZone.addEventListener('click', () => fileInput.click());

  dropZone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      fileInput.click();
    }
  });

  dropZone.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropZone.classList.add('is-dragover');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('is-dragover');
  });

  dropZone.addEventListener('drop', async (event) => {
    event.preventDefault();
    dropZone.classList.remove('is-dragover');
    const file = event.dataTransfer?.files?.[0];
    if (file) {
      await onFileSelected(file);
    }
  });

  sampleButton.addEventListener('click', async () => {
    playback.stopPlayback(false);
    textArea.value = SAMPLE_TEXT;
    fileMetaNode.textContent = 'Loaded the built-in sample text.';
    updateTextMeta();
    await renderPreviewSurface(textArea.value);
    setStatus('Sample text loaded.', 'ok');
    setProgress(0, 'Ready');
    persistState();
    setButtons();
  });

  const intakeToggleButton = appNode.querySelector('[data-echo-intake-toggle]');
  const intakeBody = appNode.querySelector('[data-echo-intake-body]');
  if (intakeToggleButton && intakeBody) {
    intakeToggleButton.addEventListener('click', () => {
      const collapsed = intakeBody.classList.toggle('is-collapsed');
      intakeToggleButton.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      intakeToggleButton.textContent = collapsed ? 'Expand' : 'Collapse';
    });
  }

  clearButton.addEventListener('click', async () => {
    playback.stopPlayback(false);
    textArea.value = '';
    fileMetaNode.textContent = 'Canvas cleared.';
    updateTextMeta();
    await renderPreviewSurface('');
    setStatus('Text cleared.', 'info');
    setProgress(0, 'Idle');
    clearStoredDraftText();
    persistState();
    setButtons();
  });

  playButton.addEventListener('click', () => void playback.startPlayback());

  pauseButton.addEventListener('click', () => {
    playback.pause();
  });

  stopButton.addEventListener('click', () => {
    playback.stopPlayback();
  });

  if (dictationEnabled) {
    recordButton.addEventListener('click', () => {
      void dictation.startDictation();
    });

    if (audioImportEnabled) {
      importAudioButton.addEventListener('click', () => {
        audioInput.value = '';
        audioInput.click();
      });

      audioInput.addEventListener('change', () => {
        const [file] = Array.from(audioInput.files || []);
        if (!file) {
          return;
        }

        void dictation.importAudioClip(file);
      });
    }

    stopRecordButton.addEventListener('click', dictation.stopDictation);
    regenerateTranscriptButton.addEventListener('click', () => {
      void dictation.regenerateTranscript();
    });
    clearTranscriptButton.addEventListener('click', dictation.clearTranscript);
    downloadTranscriptButton.addEventListener('click', dictation.downloadTranscriptMarkdown);
  }

  const cleanupOnPageExit = () => {
    clearDraftOnClose();
    window.clearTimeout(previewRenderTimer);
    clearVoicePolling();
    dictation.dispose();
    playback.stopPlayback(false);
    if (synth) {
      if (typeof synth.removeEventListener === 'function') {
        synth.removeEventListener('voiceschanged', onVoicesChanged);
      } else if (synth.onvoiceschanged === onVoicesChanged) {
        synth.onvoiceschanged = null;
      }
      synth.cancel();
    }
  };

  window.addEventListener('pagehide', cleanupOnPageExit);
  window.addEventListener('beforeunload', cleanupOnPageExit);
}
