import meSpeakModule from 'mespeak';
import meSpeakConfig from 'mespeak/src/mespeak_config.json';
import voiceEnUs from 'mespeak/voices/en/en-us.json';
import voiceEnRp from 'mespeak/voices/en/en-rp.json';
import voiceEnWm from 'mespeak/voices/en/en-wm.json';
import voiceFr from 'mespeak/voices/fr.json';
import { Mp3Encoder } from '@breezystack/lamejs';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

const meSpeak = meSpeakModule && typeof meSpeakModule === 'object' && 'default' in meSpeakModule
  ? meSpeakModule.default
  : meSpeakModule;

const VOICE_CATALOG = [
  {
    id: 'echo-core',
    label: 'ECHO Core · EN-US',
    dashboard: 'Balanced English default for general narration.',
    voiceData: voiceEnUs,
    speed: 172,
    pitch: 52,
    wordgap: 0,
  },
  {
    id: 'ariel-clear',
    label: 'Ariel Clear · EN-RP',
    dashboard: 'Clearer articulation and brighter cadence.',
    voiceData: voiceEnRp,
    speed: 178,
    pitch: 58,
    wordgap: 1,
  },
  {
    id: 'voice11-deep',
    label: 'Voice11 Deep · EN-WM',
    dashboard: 'Deeper and slower delivery for deliberate reads.',
    voiceData: voiceEnWm,
    speed: 158,
    pitch: 42,
    wordgap: 1,
  },
  {
    id: 'voice11-fr',
    label: 'Voice11 FR · FR',
    dashboard: 'French synthesis profile for francophone source text.',
    voiceData: voiceFr,
    speed: 164,
    pitch: 50,
    wordgap: 0,
  },
];

const PROFILE_QUERY_TO_VOICE_ID = {
  echo: 'echo-core',
  ariel: 'ariel-clear',
  voice11: 'voice11-deep',
};

const SUPPORTED_EXTENSIONS = new Set(['txt', 'md', 'markdown', 'docx', 'pdf']);
const TEXT_EXTENSIONS = new Set(['txt', 'md', 'markdown']);
const DOCX_EXTENSIONS = new Set(['docx']);
const PDF_EXTENSIONS = new Set(['pdf']);

let meSpeakReady = false;
let loadedVoiceIds = new Set();

function ensureMeSpeakReady() {
  if (meSpeakReady) {
    return;
  }

  meSpeak.loadConfig(meSpeakConfig);
  loadedVoiceIds = new Set();

  for (const voice of VOICE_CATALOG) {
    meSpeak.loadVoice(voice.voiceData);
    loadedVoiceIds.add(voice.voiceData.voice_id);
  }

  meSpeak.setDefaultVoice(VOICE_CATALOG[0].voiceData.voice_id);
  meSpeakReady = true;
}

function extensionFromFilename(filename) {
  const name = String(filename || '').trim().toLowerCase();
  const idx = name.lastIndexOf('.');
  return idx >= 0 ? name.slice(idx + 1) : '';
}

function normalizeText(raw) {
  return String(raw || '')
    .replace(/\u0000/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/[ \f\v]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitParagraph(paragraph, maxChars) {
  if (paragraph.length <= maxChars) {
    return [paragraph];
  }

  const sentencePieces = paragraph
    .split(/(?<=[.!?])\s+/)
    .map((piece) => piece.trim())
    .filter(Boolean);

  if (!sentencePieces.length) {
    return [paragraph];
  }

  const output = [];
  let current = '';

  for (const sentence of sentencePieces) {
    if (sentence.length > maxChars) {
      if (current) {
        output.push(current.trim());
        current = '';
      }

      const words = sentence.split(/\s+/).filter(Boolean);
      let longChunk = '';
      for (const word of words) {
        const candidate = longChunk ? `${longChunk} ${word}` : word;
        if (candidate.length <= maxChars) {
          longChunk = candidate;
        } else {
          if (longChunk) {
            output.push(longChunk.trim());
          }
          longChunk = word;
        }
      }
      if (longChunk) {
        output.push(longChunk.trim());
      }
      continue;
    }

    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      output.push(current.trim());
      current = sentence;
    }
  }

  if (current) {
    output.push(current.trim());
  }

  return output.filter(Boolean);
}

function chunkTextForSynthesis(inputText, maxCharsPerChunk = 360) {
  const text = normalizeText(inputText);
  if (!text) {
    return [];
  }

  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  const chunks = [];
  for (const paragraph of paragraphs) {
    const paragraphChunks = splitParagraph(paragraph, maxCharsPerChunk);
    for (const piece of paragraphChunks) {
      chunks.push(piece);
    }
  }

  return chunks;
}

function asUint8Array(value) {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (Array.isArray(value)) {
    return Uint8Array.from(value);
  }
  throw new Error('Unexpected audio payload shape from synthesis engine.');
}

function chunkIdToString(view, offset) {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

function decodePcmFromWavBytes(wavBytes) {
  const bytes = asUint8Array(wavBytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (chunkIdToString(view, 0) !== 'RIFF' || chunkIdToString(view, 8) !== 'WAVE') {
    throw new Error('Generated audio is not a valid WAV container.');
  }

  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataOffset = -1;
  let dataLength = 0;

  let offset = 12;
  while (offset + 8 <= view.byteLength) {
    const id = chunkIdToString(view, offset);
    const size = view.getUint32(offset + 4, true);
    const nextOffset = offset + 8 + size + (size % 2);

    if (id === 'fmt ') {
      channels = view.getUint16(offset + 10, true);
      sampleRate = view.getUint32(offset + 12, true);
      bitsPerSample = view.getUint16(offset + 22, true);
    } else if (id === 'data') {
      dataOffset = offset + 8;
      dataLength = size;
      break;
    }

    offset = nextOffset;
  }

  if (dataOffset < 0 || !sampleRate) {
    throw new Error('WAV data section missing.');
  }
  if (bitsPerSample !== 16) {
    throw new Error(`Unsupported WAV format: ${bitsPerSample}-bit PCM.`);
  }

  const sampleCount = dataLength / 2;
  const interleaved = new Int16Array(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) {
    interleaved[i] = view.getInt16(dataOffset + i * 2, true);
  }

  if (channels === 1) {
    return {
      sampleRate,
      pcm: interleaved,
    };
  }

  if (channels > 1) {
    const monoLength = Math.floor(interleaved.length / channels);
    const mono = new Int16Array(monoLength);
    for (let frame = 0; frame < monoLength; frame += 1) {
      let sum = 0;
      for (let channel = 0; channel < channels; channel += 1) {
        sum += interleaved[frame * channels + channel];
      }
      mono[frame] = Math.round(sum / channels);
    }
    return {
      sampleRate,
      pcm: mono,
    };
  }

  throw new Error('Unsupported channel layout in WAV stream.');
}

function pushEncodedFrames(pcmSamples, encoder, outChunks) {
  const frameSize = 1152;
  for (let offset = 0; offset < pcmSamples.length; offset += frameSize) {
    const frame = pcmSamples.subarray(offset, offset + frameSize);
    const encoded = encoder.encodeBuffer(frame);
    if (encoded && encoded.length) {
      outChunks.push(new Uint8Array(encoded));
    }
  }
}

function sanitizeDownloadBaseName(name) {
  const safe = String(name || 'echo-output')
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .trim();
  return safe || 'echo-output';
}

function nextFrame() {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

async function extractDocxText(file) {
  const mammoth = await import('mammoth');
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return normalizeText(result.value);
}

async function extractPdfText(file, reportProgress) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (pdfjs.GlobalWorkerOptions) {
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  }

  const data = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({ data });
  const documentProxy = await loadingTask.promise;

  const pages = [];
  for (let pageNumber = 1; pageNumber <= documentProxy.numPages; pageNumber += 1) {
    const page = await documentProxy.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item) => (item && typeof item.str === 'string' ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (pageText) {
      pages.push(pageText);
    }

    if (typeof reportProgress === 'function') {
      reportProgress(pageNumber, documentProxy.numPages);
    }
  }

  return normalizeText(pages.join('\n\n'));
}

async function extractTextFromFile(file, setStatus) {
  const ext = extensionFromFilename(file.name);

  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    throw new Error('Unsupported file type. Supported: .txt, .md, .docx, .pdf');
  }

  if (TEXT_EXTENSIONS.has(ext)) {
    return normalizeText(await file.text());
  }

  if (DOCX_EXTENSIONS.has(ext)) {
    setStatus('Extracting text from DOCX...', 'info');
    return extractDocxText(file);
  }

  if (PDF_EXTENSIONS.has(ext)) {
    setStatus('Extracting text from PDF...', 'info');
    return extractPdfText(file, (current, total) => {
      setStatus(`Extracting PDF text (page ${current}/${total})...`, 'info');
    });
  }

  throw new Error('Unsupported file type.');
}

async function synthesizeMp3FromTextChunks(chunks, voiceProfile, reportProgress) {
  ensureMeSpeakReady();

  if (!loadedVoiceIds.has(voiceProfile.voiceData.voice_id)) {
    throw new Error('Selected voice is not loaded in local synthesis engine.');
  }

  let encoder = null;
  let sampleRate = 0;
  let totalSamples = 0;
  const mp3Parts = [];

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    if (!chunk.trim()) {
      continue;
    }

    const phase = `Synthesizing chunk ${index + 1}/${chunks.length}...`;
    reportProgress(index / chunks.length, phase);

    const wavRaw = meSpeak.speak(chunk, {
      voice: voiceProfile.voiceData.voice_id,
      speed: voiceProfile.speed,
      pitch: voiceProfile.pitch,
      wordgap: voiceProfile.wordgap,
      rawdata: 'array',
    });

    const { sampleRate: chunkRate, pcm } = decodePcmFromWavBytes(wavRaw);

    if (!encoder) {
      sampleRate = chunkRate;
      encoder = new Mp3Encoder(1, sampleRate, 128);
    } else if (sampleRate !== chunkRate) {
      throw new Error(`Inconsistent sample rate during synthesis (${sampleRate} vs ${chunkRate}).`);
    }

    pushEncodedFrames(pcm, encoder, mp3Parts);
    totalSamples += pcm.length;

    reportProgress((index + 1) / chunks.length, phase);
    await nextFrame();
  }

  if (!encoder) {
    throw new Error('No audio could be synthesized from the provided text.');
  }

  const endChunk = encoder.flush();
  if (endChunk && endChunk.length) {
    mp3Parts.push(new Uint8Array(endChunk));
  }

  return {
    blob: new Blob(mp3Parts, { type: 'audio/mpeg' }),
    sampleRate,
    totalSamples,
    chunkCount: chunks.length,
  };
}

function buildVoiceOptions(selectNode) {
  selectNode.innerHTML = '';

  for (const voice of VOICE_CATALOG) {
    const option = document.createElement('option');
    option.value = voice.id;
    option.textContent = voice.label;
    selectNode.append(option);
  }
}

function profileFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('profile');
  if (!raw) {
    return '';
  }
  const normalized = raw.trim().toLowerCase();
  return PROFILE_QUERY_TO_VOICE_ID[normalized] || '';
}

function findVoiceById(voiceId) {
  return VOICE_CATALOG.find((voice) => voice.id === voiceId) || null;
}

export function initEchoFileToMp3App() {
  const appNode = document.querySelector('[data-echo-app]');
  if (!appNode) {
    return;
  }

  const dropZone = appNode.querySelector('[data-echo-dropzone]');
  const fileInput = appNode.querySelector('[data-echo-file-input]');
  const fileMetaNode = appNode.querySelector('[data-echo-file-meta]');
  const voiceSelect = appNode.querySelector('[data-echo-voice]');
  const voiceMetaNode = appNode.querySelector('[data-echo-voice-meta]');
  const textArea = appNode.querySelector('[data-echo-text]');
  const generateButton = appNode.querySelector('[data-echo-generate]');
  const statusNode = appNode.querySelector('[data-echo-status]');
  const progressNode = appNode.querySelector('[data-echo-progress]');
  const progressLabelNode = appNode.querySelector('[data-echo-progress-label]');
  const resultSection = appNode.querySelector('[data-echo-result]');
  const audioNode = appNode.querySelector('[data-echo-audio]');
  const downloadNode = appNode.querySelector('[data-echo-download]');
  const resultMetaNode = appNode.querySelector('[data-echo-result-meta]');

  if (
    !dropZone ||
    !fileInput ||
    !fileMetaNode ||
    !voiceSelect ||
    !voiceMetaNode ||
    !textArea ||
    !generateButton ||
    !statusNode ||
    !progressNode ||
    !progressLabelNode ||
    !resultSection ||
    !audioNode ||
    !downloadNode ||
    !resultMetaNode
  ) {
    return;
  }

  ensureMeSpeakReady();

  let activeFile = null;
  let activeDownloadUrl = '';
  let extracting = false;
  let generating = false;

  const setStatus = (message, tone = 'info') => {
    statusNode.textContent = message;
    statusNode.dataset.tone = tone;
  };

  const setProgress = (value, label) => {
    const clamped = Math.max(0, Math.min(100, Math.round(value)));
    progressNode.value = clamped;
    progressLabelNode.textContent = label;
  };

  const updateGenerateState = () => {
    const hasText = textArea.value.trim().length > 0;
    generateButton.disabled = !hasText || extracting || generating;
  };

  const refreshVoiceMeta = () => {
    const voice = findVoiceById(voiceSelect.value);
    if (!voice) {
      voiceMetaNode.textContent = 'No voice selected.';
      return;
    }
    voiceMetaNode.textContent = `${voice.dashboard} (voice id: ${voice.voiceData.voice_id})`;
  };

  const clearResult = () => {
    if (activeDownloadUrl) {
      URL.revokeObjectURL(activeDownloadUrl);
      activeDownloadUrl = '';
    }
    resultSection.hidden = true;
    audioNode.removeAttribute('src');
    downloadNode.removeAttribute('href');
    downloadNode.removeAttribute('download');
    resultMetaNode.textContent = '';
  };

  const setFileMetadata = (file, extractedText) => {
    const ext = extensionFromFilename(file.name);
    const words = extractedText ? extractedText.split(/\s+/).filter(Boolean).length : 0;
    const chars = extractedText ? extractedText.length : 0;
    const sizeKb = Math.max(1, Math.round(file.size / 1024));

    fileMetaNode.textContent = `File: ${file.name} (${ext || 'unknown'}, ${sizeKb} KB) · Extracted ${words} words / ${chars} chars`;
  };

  const onFileSelected = async (file) => {
    clearResult();
    activeFile = file;
    extracting = true;
    updateGenerateState();
    setProgress(0, 'Reading file...');
    setStatus(`Reading ${file.name}...`, 'info');

    try {
      const extractedText = await extractTextFromFile(file, setStatus);
      if (!extractedText) {
        throw new Error('No readable text found in this file.');
      }

      textArea.value = extractedText;
      setFileMetadata(file, extractedText);
      setStatus('File text extracted. Choose voice and click Generate MP3.', 'ok');
      setProgress(0, 'Ready');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'File extraction failed.';
      fileMetaNode.textContent = `File: ${file.name}`;
      textArea.value = '';
      setStatus(message, 'error');
      setProgress(0, 'Extraction failed');
    } finally {
      extracting = false;
      updateGenerateState();
    }
  };

  const extractFirstFile = (fileList) => {
    if (!fileList || !fileList.length) {
      return null;
    }
    return fileList[0] || null;
  };

  const onGenerateClick = async () => {
    const text = normalizeText(textArea.value);
    const voice = findVoiceById(voiceSelect.value);

    if (!text) {
      setStatus('Upload a supported file or paste text before generating.', 'error');
      return;
    }

    if (!voice) {
      setStatus('Select a voice before generating.', 'error');
      return;
    }

    const chunks = chunkTextForSynthesis(text, 360);
    if (!chunks.length) {
      setStatus('No synthesis chunks were produced from the text.', 'error');
      return;
    }

    generating = true;
    updateGenerateState();
    clearResult();
    setStatus(`Generating MP3 with ${voice.label}...`, 'info');
    setProgress(0, `Preparing ${chunks.length} chunk(s)...`);

    try {
      const startedAt = performance.now();
      const synthesisResult = await synthesizeMp3FromTextChunks(chunks, voice, (ratio, label) => {
        const percent = Math.round(ratio * 100);
        setProgress(percent, label);
      });

      const elapsedSec = ((performance.now() - startedAt) / 1000).toFixed(2);
      activeDownloadUrl = URL.createObjectURL(synthesisResult.blob);

      const sourceFileName = activeFile ? activeFile.name : 'echo-input.txt';
      const safeBaseName = sanitizeDownloadBaseName(sourceFileName);
      const outputName = `${safeBaseName}-${voice.id}.mp3`;

      audioNode.src = activeDownloadUrl;
      downloadNode.href = activeDownloadUrl;
      downloadNode.download = outputName;
      resultMetaNode.textContent = `${synthesisResult.chunkCount} chunks · ${synthesisResult.sampleRate} Hz · ${(synthesisResult.totalSamples / synthesisResult.sampleRate).toFixed(2)} sec · ${Math.round(synthesisResult.blob.size / 1024)} KB · ${elapsedSec}s`; 
      resultSection.hidden = false;

      setProgress(100, 'MP3 ready');
      setStatus(`MP3 generated successfully with ${voice.label}.`, 'ok');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Generation failed.';
      setStatus(message, 'error');
      setProgress(0, 'Generation failed');
    } finally {
      generating = false;
      updateGenerateState();
    }
  };

  buildVoiceOptions(voiceSelect);

  const requestedVoiceFromQuery = profileFromQuery();
  if (requestedVoiceFromQuery && findVoiceById(requestedVoiceFromQuery)) {
    voiceSelect.value = requestedVoiceFromQuery;
  } else {
    voiceSelect.value = VOICE_CATALOG[0].id;
  }

  refreshVoiceMeta();
  setStatus('Drop a file to start. Supported: .txt, .md, .docx, .pdf', 'info');
  setProgress(0, 'Idle');
  updateGenerateState();

  voiceSelect.addEventListener('change', () => {
    refreshVoiceMeta();
  });

  textArea.addEventListener('input', () => {
    updateGenerateState();
  });

  fileInput.addEventListener('change', async () => {
    const file = extractFirstFile(fileInput.files);
    if (file) {
      await onFileSelected(file);
    }
    fileInput.value = '';
  });

  dropZone.addEventListener('click', () => {
    fileInput.click();
  });

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

  dropZone.addEventListener('dragleave', (event) => {
    event.preventDefault();
    dropZone.classList.remove('is-dragover');
  });

  dropZone.addEventListener('drop', async (event) => {
    event.preventDefault();
    dropZone.classList.remove('is-dragover');
    const file = extractFirstFile(event.dataTransfer && event.dataTransfer.files ? event.dataTransfer.files : null);
    if (file) {
      await onFileSelected(file);
    }
  });

  generateButton.addEventListener('click', async () => {
    await onGenerateClick();
  });

  window.addEventListener('beforeunload', () => {
    if (activeDownloadUrl) {
      URL.revokeObjectURL(activeDownloadUrl);
      activeDownloadUrl = '';
    }
  });
}
