/**
 * Hardline dictation: microphone / audio import → STT → transcript panel.
 * Factory so app.js can share setButtons / draft intake without a godfile.
 */

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
  DICTATION_ENDPOINT,
  DICTATION_TIMESLICE_MS,
  DICTATION_PLACEHOLDER,
  NORMALIZED_TRANSCRIPTION_SAMPLE_RATE,
} from './config.js';
import {
  normalizeText,
  pickRecordingMimeType,
  mimeTypeToExtension,
  buildDictationTitle,
  closeAudioContext,
  formatRecordingClock,
  countWords,
} from './text.js';

/**
 * @param {object} api shared app surface
 */
export function createDictationController(api) {
  const {
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
    setButtons,
    setStatus,
    setProgress,
    updateTextMeta,
    renderPreviewSurface,
    persistState,
  } = api;

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


  const dispose = () => {
    clearDictationTimer();
    releaseDictationStream();
    if (dictationRecorder && dictationRecorder.state !== 'inactive') {
      try {
        dictationRecorder.stop();
      } catch {
        /* best-effort */
      }
    }
    dictationRecorder = null;
  };

  return {
    setDictationButtons,
    startDictation,
    stopDictation,
    clearTranscript,
    regenerateTranscript,
    downloadTranscriptMarkdown,
    importAudioClip,
    dispose,
    get recording() {
      return dictationRecording;
    },
    get transcribing() {
      return dictationTranscribing;
    },
  };
}
