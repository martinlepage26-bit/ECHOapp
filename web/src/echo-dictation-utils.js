function padTimeSegment(value, size = 2) {
  return String(value).padStart(size, '0');
}

function clampPcmSample(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(-1, Math.min(1, value));
}

export function shouldNormalizeAudioForTranscription({ mimeType = '', filename = '' } = {}) {
  const normalizedMimeType = String(mimeType || '').trim().toLowerCase();
  const normalizedFilename = String(filename || '').trim().toLowerCase();

  if (normalizedMimeType === 'audio/mp4' || normalizedMimeType === 'audio/m4a' || normalizedMimeType === 'audio/x-m4a') {
    return true;
  }

  if (normalizedMimeType === 'video/mp4') {
    return true;
  }

  return normalizedFilename.endsWith('.m4a') || normalizedFilename.endsWith('.mp4');
}

export function replaceFileExtension(filename, nextExtension) {
  const cleanedFilename = String(filename || '').trim();
  const cleanedExtension = String(nextExtension || '').trim().replace(/^\.+/, '');

  if (!cleanedExtension) {
    return cleanedFilename || 'echo-dictation';
  }

  if (!cleanedFilename) {
    return `echo-dictation.${cleanedExtension}`;
  }

  const nextSuffix = `.${cleanedExtension}`;
  return cleanedFilename.replace(/\.[a-z0-9]+$/i, nextSuffix) === cleanedFilename
    ? `${cleanedFilename}${nextSuffix}`
    : cleanedFilename.replace(/\.[a-z0-9]+$/i, nextSuffix);
}

export function mixAudioChannelsToMono(channelData = []) {
  const channels = Array.isArray(channelData) ? channelData.filter(Boolean) : [];
  if (!channels.length) {
    return new Float32Array();
  }

  const frameCount = channels.reduce((smallest, channel) => Math.min(smallest, channel.length), channels[0].length);
  const mono = new Float32Array(frameCount);

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    let total = 0;
    for (let channelIndex = 0; channelIndex < channels.length; channelIndex += 1) {
      total += Number(channels[channelIndex][frameIndex] || 0);
    }
    mono[frameIndex] = total / channels.length;
  }

  return mono;
}

export function resampleMonoAudio(monoSamples, sourceRate, targetRate = 16000) {
  const samples = monoSamples instanceof Float32Array ? monoSamples : new Float32Array(monoSamples || []);
  const safeSourceRate = Number(sourceRate);
  const safeTargetRate = Number(targetRate);

  if (!samples.length || !Number.isFinite(safeSourceRate) || safeSourceRate <= 0) {
    return new Float32Array();
  }

  if (!Number.isFinite(safeTargetRate) || safeTargetRate <= 0 || safeTargetRate === safeSourceRate) {
    return new Float32Array(samples);
  }

  const targetLength = Math.max(1, Math.round(samples.length * (safeTargetRate / safeSourceRate)));
  const resampled = new Float32Array(targetLength);
  const ratio = safeSourceRate / safeTargetRate;

  for (let index = 0; index < targetLength; index += 1) {
    const sourcePosition = index * ratio;
    const lowerIndex = Math.floor(sourcePosition);
    const upperIndex = Math.min(samples.length - 1, lowerIndex + 1);
    const interpolation = sourcePosition - lowerIndex;
    const lowerValue = samples[Math.min(lowerIndex, samples.length - 1)] || 0;
    const upperValue = samples[upperIndex] || 0;
    resampled[index] = lowerValue + (upperValue - lowerValue) * interpolation;
  }

  return resampled;
}

export function encodeMonoPcm16Wav(samples, sampleRate = 16000) {
  const pcmSamples = samples instanceof Float32Array ? samples : new Float32Array(samples || []);
  const safeSampleRate = Number.isFinite(Number(sampleRate)) && Number(sampleRate) > 0 ? Math.round(Number(sampleRate)) : 16000;
  const dataSize = pcmSamples.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  const writeAscii = (offset, text) => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, safeSampleRate, true);
  view.setUint32(28, safeSampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, dataSize, true);

  for (let index = 0; index < pcmSamples.length; index += 1) {
    const sample = clampPcmSample(pcmSamples[index]);
    view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }

  return bytes;
}

export function formatTranscriptTimestamp(seconds) {
  const numeric = Number(seconds);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return '00:00.000';
  }

  const wholeSeconds = Math.floor(numeric);
  const minutes = Math.floor(wholeSeconds / 60);
  const remainingSeconds = wholeSeconds % 60;
  const milliseconds = Math.round((numeric - wholeSeconds) * 1000);

  return `${padTimeSegment(minutes)}:${padTimeSegment(remainingSeconds)}.${padTimeSegment(milliseconds, 3)}`;
}

export function buildEchoTranscriptFilename(title) {
  const cleaned = String(title || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  const base = cleaned || 'echo-dictation';
  return base.endsWith('.md') ? base : `${base}.md`;
}

export function buildEchoTranscriptMarkdown({
  title = 'ECHO Dictation',
  transcript = '',
  language = '',
  durationSeconds = 0,
  wordCount = 0,
  sourceLabel = 'ECHO dictation console',
  createdAt = new Date().toISOString(),
  segments = [],
} = {}) {
  const normalizedTranscript = String(transcript || '').trim();
  const normalizedLanguage = String(language || '').trim() || 'auto';
  const normalizedSource = String(sourceLabel || '').trim() || 'ECHO dictation console';
  const normalizedCreatedAt = String(createdAt || '').trim() || new Date().toISOString();
  const normalizedDuration = Number.isFinite(Number(durationSeconds))
    ? `${Number(durationSeconds).toFixed(1)} seconds`
    : '0.0 seconds';
  const normalizedWordCount = Number.isFinite(Number(wordCount)) ? Number(wordCount) : 0;
  const safeSegments = Array.isArray(segments) ? segments : [];

  const lines = [
    `# ${String(title || 'ECHO Dictation').trim() || 'ECHO Dictation'}`,
    '',
    '- Generated by: ECHO',
    `- Source: ${normalizedSource}`,
    `- Created: ${normalizedCreatedAt}`,
    `- Language: ${normalizedLanguage}`,
    `- Duration: ${normalizedDuration}`,
    `- Word count: ${normalizedWordCount}`,
    '',
    '## Transcript',
    '',
    normalizedTranscript || '_No transcript text was captured._',
  ];

  if (safeSegments.length) {
    lines.push('', '## Segments', '');
    safeSegments.forEach((segment) => {
      const start = formatTranscriptTimestamp(segment?.start);
      const end = formatTranscriptTimestamp(segment?.end);
      const textLine = String(segment?.text || '').trim();
      if (!textLine) {
        return;
      }
      lines.push(`- [${start} -> ${end}] ${textLine}`);
    });
  }

  return `${lines.join('\n').trim()}\n`;
}
