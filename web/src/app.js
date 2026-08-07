/**
 * Hardline ECHO reader application (DOM wiring + playback/dictation loop).
 */
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import {
  buildEchoTranscriptFilename,
  buildEchoTranscriptMarkdown,
  encodeMonoPcm16Wav,
  mixAudioChannelsToMono,
  replaceFileExtension,
  resampleMonoAudio,
  shouldNormalizeAudioForTranscription,
} from './echo-dictation-utils.js';
import {
  SAMPLE_TEXT,
  STORAGE_KEY,
  VOICE_POLL_INTERVAL_MS,
  VOICE_POLL_MAX_ATTEMPTS,
  PREVIEW_RENDER_DEBOUNCE_MS,
  DEFAULT_SURFACE_BATCH_SIZE,
  LARGE_SURFACE_BATCH_SIZE,
  LARGE_DRAFT_WORD_THRESHOLD,
  HIGHLIGHT_SCROLL_THROTTLE_MS,
  DICTATION_ENDPOINT,
  TTS_ENDPOINT,
  ONLINE_TTS_MAX_CHARS,
  ONLINE_TTS_VOICE,
  DICTATION_TIMESLICE_MS,
  DICTATION_PLACEHOLDER,
  RECORDING_MIME_CANDIDATES,
  NORMALIZED_TRANSCRIPTION_SAMPLE_RATE,
  SUPPORTED_EXTENSIONS,
  ECHO_PROFILE_ID,
  SYSTEM_PROFILE_ID,
  CLONE_VOICE_IDS,
} from './config.js';
import {
  PROFILE_CATALOG,
  findProfile,
  profileFromQuery,
  persistQueryProfile,
} from './profiles.js';
import {
  normalizeText,
  extensionFromFilename,
  pickRecordingMimeType,
  mimeTypeToExtension,
  fileNameStem,
  buildDictationTitle,
  closeAudioContext,
  formatRecordingClock,
  clampNumber,
  countWords,
  estimateMinutes,
  formatMinutes,
  prepareTtsText,
  chunkTextForPlayback,
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
  waitForPaint,
  renderWordSurface,
  findWordIndexForChar,
} from './surface.js';
import {
  chooseVoiceForProfile,
  formatVoiceMeta,
  safeFileMeta,
  setVoiceSelectPlaceholder,
} from './browser-voices.js';

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
  let playbackChunks = [];
  let playbackChunkIndex = 0;
  let playbackSessionId = 0;
  let activeUtterance = null;
  let onlineAudio = null;
  let onlineObjectUrl = null;
  let onlineNormalizedText = '';
  let playing = false;
  let paused = false;
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
  let dictationRecorder = null;
  let dictationStream = null;
  let dictationChunks = [];
  let dictationRecording = false;
  let dictationTranscribing = false;
  let dictationStartedAt = 0;
  let dictationTimer = 0;
  let dictationCapturedDurationMs = 0;
  let lastTranscriptionRequest = null;
  let transcriptState = {
    title: 'ECHO Dictation',
    transcript: '',
    language: '',
    durationSeconds: 0,
    wordCount: 0,
    sourceLabel: 'Browser dictation console',
    createdAt: '',
    segments: [],
  };

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

  const setDictationStatus = (message, tone = 'info') => {
    if (!dictationEnabled) {
      return;
    }
    dictationStatusNode.textContent = message;
    dictationStatusNode.dataset.tone = tone;
  };

  const setDictationMeta = (message) => {
    if (!dictationEnabled) {
      return;
    }
    dictationMetaNode.textContent = message;
  };

  const updateDictationDuration = (milliseconds) => {
    if (!dictationEnabled) {
      return;
    }
    dictationDurationNode.textContent = formatRecordingClock(milliseconds);
  };

  const renderDictationOutput = () => {
    if (!dictationEnabled) {
      return;
    }
    dictationOutputNode.textContent = transcriptState.transcript || DICTATION_PLACEHOLDER;
  };

  const clearDictationTimer = () => {
    if (dictationTimer) {
      window.clearInterval(dictationTimer);
      dictationTimer = 0;
    }
  };

  const releaseDictationStream = () => {
    if (!dictationStream) {
      return;
    }
    dictationStream.getTracks().forEach((track) => track.stop());
    dictationStream = null;
  };

  const setDictationButtons = () => {
    if (!dictationEnabled) {
      return;
    }

    const dictationSupported =
      Boolean(window.navigator.mediaDevices?.getUserMedia) && typeof window.MediaRecorder === 'function';

    recordButton.disabled = !dictationSupported || dictationRecording || dictationTranscribing;
    if (audioImportEnabled) {
      importAudioButton.disabled = dictationRecording || dictationTranscribing;
      audioInput.disabled = dictationRecording || dictationTranscribing;
    }
    stopRecordButton.disabled = !dictationRecording;
    regenerateTranscriptButton.disabled = dictationRecording || dictationTranscribing || !lastTranscriptionRequest;
    clearTranscriptButton.disabled = dictationRecording || dictationTranscribing || !transcriptState.transcript;
    downloadTranscriptButton.disabled = dictationRecording || dictationTranscribing || !transcriptState.transcript;
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
    // Sample voices use local clone TTS via /api/echo-tts — no browser voices required.
    const onlineEcho = CLONE_VOICE_IDS.has(activeProfileId);
    const speechUnavailable =
      !onlineEcho && (!synth || typeof window.SpeechSynthesisUtterance !== 'function');
    const voicesUnavailable = !onlineEcho && !availableVoices.length;

    playButton.disabled = speechUnavailable || voicesUnavailable || extracting || !hasText || (playing && !paused);
    pauseButton.disabled = speechUnavailable || !playing || paused;
    stopButton.disabled = speechUnavailable || (!playing && !paused);
    playButton.textContent = '▶';
    playButton.setAttribute('aria-label', paused ? 'Resume' : 'Play');
    pauseButton.textContent = '❚❚';
    pauseButton.setAttribute('aria-label', 'Pause');
    stopButton.textContent = '■';
    stopButton.setAttribute('aria-label', 'Stop');
    setDictationButtons();
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

  const maybeLoadTranscriptIntoDraft = async (transcript) => {
    if (normalizeText(textArea.value)) {
      return;
    }

    textArea.value = transcript;
    fileMetaNode.textContent = `Loaded from ${String(transcriptState.sourceLabel || 'transcript').toLowerCase()}.`;
    updateTextMeta();
    await renderPreviewSurface(transcript);
    persistState();
    setButtons();
    setStatus('Transcript loaded into the draft intake. Press Play to hear it back.', 'ok');
    setProgress(0, 'Ready');
  };

  const normalizeAudioBlobForTranscription = async (blob, fileName = '') => {
    if (!shouldNormalizeAudioForTranscription({ mimeType: blob?.type, filename: fileName })) {
      return {
        blob,
        mimeType: blob?.type || 'application/octet-stream',
        fileName,
        normalized: false,
      };
    }

    const AudioContextCtor = window.AudioContext || window['webkitAudioContext'];
    if (typeof AudioContextCtor !== 'function') {
      throw new Error('This browser cannot normalize M4A audio yet. Use WAV, MP3, WebM, or another browser.');
    }

    const audioContext = new AudioContextCtor();
    try {
      const sourceBuffer = await blob.arrayBuffer();
      const decoded = await audioContext.decodeAudioData(sourceBuffer.slice(0));
      const monoSamples = mixAudioChannelsToMono(
        Array.from({ length: decoded.numberOfChannels }, (_, index) => decoded.getChannelData(index)),
      );
      const resampled = resampleMonoAudio(monoSamples, decoded.sampleRate, NORMALIZED_TRANSCRIPTION_SAMPLE_RATE);
      const wavBytes = encodeMonoPcm16Wav(resampled, NORMALIZED_TRANSCRIPTION_SAMPLE_RATE);

      return {
        blob: new Blob([wavBytes], { type: 'audio/wav' }),
        mimeType: 'audio/wav',
        fileName: replaceFileExtension(fileName || 'echo-dictation.wav', 'wav'),
        normalized: true,
      };
    } catch (error) {
      throw new Error(
        error instanceof Error
          ? `Audio normalization failed: ${error.message}`
          : 'Audio normalization failed before transcription.',
      );
    } finally {
      await closeAudioContext(audioContext);
    }
  };

  const transcribeDictationBlob = async (blob, options = {}) => {
    if (!dictationEnabled) {
      return;
    }

    const {
      fileName: requestedFileName = '',
      sourceLabel = 'Browser dictation console',
    } = options;
    const languageHint = String(window.navigator.language || '')
      .slice(0, 2)
      .toLowerCase();
    const createdAt = new Date().toISOString();
    const fallbackFileName = `echo-dictation-${createdAt.replace(/[:.]/g, '-')}.${mimeTypeToExtension(blob.type || 'audio/webm')}`;
    const targetUrl = languageHint
      ? `${DICTATION_ENDPOINT}?language=${encodeURIComponent(languageHint)}`
      : DICTATION_ENDPOINT;

    dictationTranscribing = true;
    setDictationStatus('Preparing audio for transcription...', 'info');
    setDictationMeta(
      `${Math.max(1, Math.round(blob.size / 1024)).toLocaleString()} KB captured · awaiting transcript`,
    );
    updateDictationDuration(dictationCapturedDurationMs);
    setButtons();

    try {
      lastTranscriptionRequest = {
        blob,
        options: {
          fileName: requestedFileName || fallbackFileName,
          sourceLabel,
        },
        capturedDurationMs: dictationCapturedDurationMs,
      };
      const preparedAudio = await normalizeAudioBlobForTranscription(blob, requestedFileName || fallbackFileName);
      setDictationStatus('Uploading audio clip to the ECHO transcription worker...', 'info');
      setDictationMeta(
        preparedAudio.normalized
          ? `${Math.max(1, Math.round(preparedAudio.blob.size / 1024)).toLocaleString()} KB WAV normalized locally · uploading`
          : `${Math.max(1, Math.round(preparedAudio.blob.size / 1024)).toLocaleString()} KB captured · uploading`,
      );

      const response = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': preparedAudio.mimeType,
          'X-Echo-Filename': preparedAudio.fileName,
          'X-Echo-Language': languageHint,
        },
        body: preparedAudio.blob,
      });

      let payload = null;
      try {
        payload = await response.json();
      } catch {
        throw new Error(`Transcription returned a non-JSON response (${response.status}).`);
      }

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || `Transcription failed (${response.status}).`);
      }

      const transcript = normalizeText(payload.text);
      if (!transcript) {
        throw new Error('Transcription returned no readable text.');
      }

      transcriptState = {
        title: buildDictationTitle(requestedFileName || preparedAudio.fileName),
        transcript,
        language: String(payload?.transcription_info?.language || languageHint || '').trim(),
        durationSeconds: Number(payload?.transcription_info?.duration || 0),
        wordCount: Number(payload?.word_count || countWords(transcript)),
        sourceLabel,
        createdAt,
        segments: Array.isArray(payload?.segments) ? payload.segments : [],
      };

      renderDictationOutput();
      updateDictationDuration(
        transcriptState.durationSeconds > 0
          ? transcriptState.durationSeconds * 1000
          : dictationCapturedDurationMs,
      );

      const languageLabel = transcriptState.language || 'auto-detected';
      const durationLabel =
        transcriptState.durationSeconds > 0
          ? `${transcriptState.durationSeconds.toFixed(1)} seconds`
          : `${(dictationCapturedDurationMs / 1000).toFixed(1)} seconds`;
      setDictationStatus('Transcript ready. Download the markdown file or continue in the intake deck.', 'ok');
      setDictationMeta(
        `${transcriptState.wordCount.toLocaleString()} words · ${languageLabel} · ${durationLabel}`,
      );
      await maybeLoadTranscriptIntoDraft(transcript);
    } catch (error) {
      setDictationStatus(error instanceof Error ? error.message : 'Transcription failed.', 'error');
      setDictationMeta('Check microphone permissions or clip format and try another short capture.');
    } finally {
      dictationTranscribing = false;
      setButtons();
    }
  };

  const importAudioClip = async (file) => {
    if (!dictationEnabled || !file) {
      return;
    }

    if (!String(file.type || '').startsWith('audio/') && !/\.(m4a|mp4|mp3|wav|ogg|webm)$/i.test(file.name || '')) {
      setDictationStatus('Choose an audio clip such as M4A, MP3, WAV, OGG, or WebM.', 'error');
      setDictationMeta('The imported file must be an audio recording that can be normalized for transcription.');
      setButtons();
      return;
    }

    dictationCapturedDurationMs = 0;
    updateDictationDuration(0);
    setDictationStatus('Clip selected. Preparing import...', 'info');
    setDictationMeta(`${file.name} · ${Math.max(1, Math.round(file.size / 1024)).toLocaleString()} KB`);
    setButtons();

    await transcribeDictationBlob(file, {
      fileName: file.name || 'echo-imported-audio',
      sourceLabel: `Imported audio clip (${file.name || 'audio file'})`,
    });
  };

  const startDictation = async () => {
    if (!dictationEnabled) {
      return;
    }

    if (!window.navigator.mediaDevices?.getUserMedia || typeof window.MediaRecorder !== 'function') {
      setDictationStatus('Microphone recording is not available in this browser.', 'error');
      setDictationMeta('Use a compatible browser with MediaRecorder support to capture dictation.');
      setButtons();
      return;
    }

    const mimeType = pickRecordingMimeType();

    try {
      dictationChunks = [];
      dictationCapturedDurationMs = 0;
      dictationStream = await window.navigator.mediaDevices.getUserMedia({ audio: true });
      dictationRecorder = mimeType
        ? new window.MediaRecorder(dictationStream, { mimeType })
        : new window.MediaRecorder(dictationStream);

      dictationRecorder.addEventListener('dataavailable', (event) => {
        if (event.data && event.data.size > 0) {
          dictationChunks.push(event.data);
        }
      });

      dictationRecorder.addEventListener('stop', async () => {
        const recordedMimeType = dictationRecorder?.mimeType || mimeType || 'application/octet-stream';
        const audioBlob = new Blob(dictationChunks, { type: recordedMimeType });
        dictationChunks = [];
        dictationRecorder = null;
        releaseDictationStream();

        if (!audioBlob.size) {
          dictationTranscribing = false;
          setDictationStatus('Recording finished, but no audio was captured.', 'error');
          setDictationMeta('Try again and speak a little closer to the microphone.');
          setButtons();
          return;
        }

        await transcribeDictationBlob(audioBlob, {
          fileName: `echo-dictation-${new Date().toISOString().replace(/[:.]/g, '-')}.${mimeTypeToExtension(recordedMimeType)}`,
          sourceLabel: 'Browser dictation console',
        });
      });

      dictationRecorder.addEventListener('error', () => {
        dictationRecording = false;
        dictationTranscribing = false;
        clearDictationTimer();
        releaseDictationStream();
        dictationRecorder = null;
        setDictationStatus('Microphone recording failed.', 'error');
        setDictationMeta('The recording surface reported an error before the clip could be transcribed.');
        setButtons();
      });

      dictationRecorder.start(DICTATION_TIMESLICE_MS);
      dictationRecording = true;
      dictationTranscribing = false;
      dictationStartedAt = Date.now();
      updateDictationDuration(0);
      clearDictationTimer();
      dictationTimer = window.setInterval(() => {
        updateDictationDuration(Date.now() - dictationStartedAt);
      }, 100);

      const formatLabel = mimeTypeToExtension(dictationRecorder.mimeType || mimeType || 'audio/webm').toUpperCase();
      setDictationStatus('Recording... press Stop when ready.', 'ok');
      setDictationMeta(`${formatLabel} microphone capture armed.`);
      setButtons();
    } catch (error) {
      dictationRecording = false;
      dictationTranscribing = false;
      clearDictationTimer();
      releaseDictationStream();
      dictationRecorder = null;
      setDictationStatus(
        error instanceof Error ? error.message : 'Unable to access the microphone for dictation.',
        'error',
      );
      setDictationMeta('Allow microphone access and try again.');
      setButtons();
    }
  };

  const stopDictation = () => {
    if (!dictationEnabled || !dictationRecorder || dictationRecorder.state === 'inactive') {
      return;
    }

    dictationCapturedDurationMs = Math.max(0, Date.now() - dictationStartedAt);
    dictationRecording = false;
    dictationTranscribing = true;
    clearDictationTimer();
    updateDictationDuration(dictationCapturedDurationMs);
    setDictationStatus('Finishing recording and preparing transcription...', 'info');
    setDictationMeta('Wrapping microphone buffer...');
    dictationRecorder.stop();
    setButtons();
  };

  const clearTranscript = () => {
    if (!dictationEnabled) {
      return;
    }

    transcriptState = {
      title: 'ECHO Dictation',
      transcript: '',
      language: '',
      durationSeconds: 0,
      wordCount: 0,
      sourceLabel: 'Browser dictation console',
      createdAt: '',
      segments: [],
    };
    dictationCapturedDurationMs = 0;
    renderDictationOutput();
    updateDictationDuration(0);
    setDictationStatus('Transcript cleared.', 'info');
    setDictationMeta('Capture a clip to render transcript text here.');
    setButtons();
  };

  const regenerateTranscript = async () => {
    if (!dictationEnabled || !lastTranscriptionRequest || dictationRecording || dictationTranscribing) {
      return;
    }

    dictationCapturedDurationMs = lastTranscriptionRequest.capturedDurationMs || 0;
    updateDictationDuration(dictationCapturedDurationMs);
    setDictationStatus('Regenerating transcript from the last audio clip...', 'info');
    setDictationMeta('Reusing the last captured/imported audio buffer.');
    setButtons();

    await transcribeDictationBlob(lastTranscriptionRequest.blob, lastTranscriptionRequest.options);
  };

  const downloadTranscriptMarkdown = () => {
    if (!dictationEnabled || !transcriptState.transcript) {
      return;
    }

    const markdown = buildEchoTranscriptMarkdown(transcriptState);
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = buildEchoTranscriptFilename(transcriptState.title);
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 0);
    setDictationStatus('Transcript markdown downloaded.', 'ok');
    setDictationMeta('The transcript packet was written as a local .md file.');
  };

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
    return availableVoices.find((entry) => entry.voiceURI === voiceSelect.value) || null;
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
      setStatus(`Reading with ${findProfile(activeProfileId).label}.`, 'ok');
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
    const profile = findProfile(activeProfileId);
    const voiceId = profile.onlineVoiceId || activeProfileId || ONLINE_TTS_VOICE;
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
      setProgress(ratio * 100, `Reading (${findProfile(activeProfileId).label})`);
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
    setStatus(`Reading with ${findProfile(activeProfileId).label}.`, 'ok');
    setButtons();
  };

  const startPlayback = async () => {
    // Stop static voice samples when starting live readback.
    try {
      if (typeof stopSamplePreview === 'function') {
        stopSamplePreview();
      }
    } catch {
      // samples may not be wired yet during early init
    }

    const useOnlineEcho = CLONE_VOICE_IDS.has(activeProfileId);

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
      if (!availableVoices.length) {
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
        if (synth && availableVoices.length) {
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

  const onFileSelected = async (file) => {
    stopPlayback(false);
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
    if (hadNoVoices && !playing && !paused && !extracting) {
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
        if (!availableVoices.length && !playing && !paused && !extracting) {
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
    stopPlayback(false);
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
        if (paused && (activeUtterance || onlineAudio)) {
          void startPlayback();
        } else if (normalizeText(textArea.value)) {
          void startPlayback();
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
    if (playing || paused) {
      stopPlayback(false);
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
    stopPlayback(false);
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
    stopPlayback(false);
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

  playButton.addEventListener('click', startPlayback);

  pauseButton.addEventListener('click', () => {
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
  });

  stopButton.addEventListener('click', () => {
    stopPlayback();
  });

  if (dictationEnabled) {
    recordButton.addEventListener('click', () => {
      void startDictation();
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

        void importAudioClip(file);
      });
    }

    stopRecordButton.addEventListener('click', stopDictation);
    regenerateTranscriptButton.addEventListener('click', () => {
      void regenerateTranscript();
    });
    clearTranscriptButton.addEventListener('click', clearTranscript);
    downloadTranscriptButton.addEventListener('click', downloadTranscriptMarkdown);
  }

  const cleanupOnPageExit = () => {
    clearDraftOnClose();
    window.clearTimeout(previewRenderTimer);
    clearVoicePolling();
    clearDictationTimer();
    releaseDictationStream();
    if (dictationRecorder && dictationRecorder.state !== 'inactive') {
      dictationRecorder.stop();
    }
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
