/** Text normalize / chunk / meta helpers. */
import { RECORDING_MIME_CANDIDATES } from './config.js';

export function normalizeText(raw) {
  return String(raw || '')
    .replace(/\u0000/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/[ \f\v]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function extensionFromFilename(filename) {
  const name = String(filename || '').trim().toLowerCase();
  const idx = name.lastIndexOf('.');
  return idx >= 0 ? name.slice(idx + 1) : '';
}

export function pickRecordingMimeType() {
  if (typeof window === 'undefined' || typeof window.MediaRecorder !== 'function') {
    return '';
  }

  if (typeof window.MediaRecorder.isTypeSupported !== 'function') {
    return '';
  }

  return RECORDING_MIME_CANDIDATES.find((candidate) => window.MediaRecorder.isTypeSupported(candidate)) || '';
}

export function mimeTypeToExtension(mimeType) {
  const value = String(mimeType || '').toLowerCase();
  if (value.includes('m4a') || value.includes('x-m4a')) return 'm4a';
  if (value.includes('mp4')) return 'mp4';
  if (value.includes('webm')) return 'webm';
  if (value.includes('ogg')) return 'ogg';
  if (value.includes('wav')) return 'wav';
  if (value.includes('mpeg') || value.includes('mp3')) return 'mp3';
  return 'bin';
}

export function fileNameStem(filename, fallback = 'echo-dictation') {
  const cleaned = String(filename || '').trim();
  if (!cleaned) {
    return fallback;
  }

  return cleaned.replace(/\.[a-z0-9]+$/i, '') || fallback;
}

export function buildDictationTitle(filename) {
  const stem = fileNameStem(filename, 'ECHO Dictation')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!stem) {
    return 'ECHO Dictation';
  }

  return stem
    .split(' ')
    .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join(' ');
}

export function closeAudioContext(context) {
  if (!context || typeof context.close !== 'function') {
    return Promise.resolve();
  }

  try {
    const result = context.close();
    return result && typeof result.then === 'function' ? result.catch(() => {}) : Promise.resolve();
  } catch {
    return Promise.resolve();
  }
}

export function formatRecordingClock(milliseconds) {
  const safeMilliseconds = Math.max(0, Math.round(Number(milliseconds) || 0));
  const minutes = Math.floor(safeMilliseconds / 60000);
  const seconds = Math.floor((safeMilliseconds % 60000) / 1000);
  const tenths = Math.floor((safeMilliseconds % 1000) / 100);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${tenths}`;
}

export function clampNumber(value, min, max, fallback) {
  const parsed = Number.parseFloat(String(value ?? ''));
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

export function countWords(text) {
  return normalizeText(text).split(/\s+/).filter(Boolean).length;
}

export function estimateMinutes(text, rate) {
  const words = countWords(text);
  if (!words) {
    return 0;
  }
  const effectiveRate = Math.max(0.5, rate || 1);
  return words / (165 * effectiveRate);
}

export function formatMinutes(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return '~0 min';
  }
  if (value < 1) {
    return '<1 min';
  }
  return `~${Math.round(value)} min`;
}

export function trimChunk(text, start, end) {
  const slice = text.slice(start, end);
  const leading = slice.match(/^\s*/)?.[0].length || 0;
  const trailing = slice.match(/\s*$/)?.[0].length || 0;
  const chunkStart = start + leading;
  const chunkEnd = Math.max(chunkStart, end - trailing);
  const chunkText = text.slice(chunkStart, chunkEnd);

  if (!chunkText) {
    return null;
  }

  return {
    text: chunkText,
    start: chunkStart,
    end: chunkEnd,
  };
}

// Prepare text for TTS — apply length-preserving transforms so word-boundary
// char offsets stay in sync with the display surface. Paragraph breaks become
// sentence-ending pauses; dashes become natural commas; ellipsis becomes period.
export function prepareTtsText(text) {
  return text
    .replace(/\n\n/g, '. ')   // paragraph break → sentence pause (2 → 2 chars)
    .replace(/\n/g, ' ')      // single newline → space (1 → 1 char)
    .replace(/—/g, ', ')      // em dash → comma pause (1 → 2 chars, tiny drift)
    .replace(/–/g, ' ')       // en dash → space (1 → 1 char)
    .replace(/…/g, '.')       // ellipsis → period (1 → 1 char)
    .replace(/\s{2,}/g, ' '); // collapse any doubled spaces from above
}

// Chunk long reads to avoid browser speech synthesis stalls on larger drafts.
// Smaller chunks (~380 chars ≈ 1-2 sentences) let the TTS engine apply a
// natural intonation arc to each sentence instead of ironing it flat.
export function chunkTextForPlayback(inputText, maxChars = 380) {
  const text = normalizeText(inputText);
  if (!text) {
    return [];
  }

  const chunks = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(text.length, start + maxChars);

    if (end < text.length) {
      const slice = text.slice(start, end);
      const candidates = [
        slice.lastIndexOf('\n\n'),
        slice.lastIndexOf('. '),
        slice.lastIndexOf('! '),
        slice.lastIndexOf('? '),
        slice.lastIndexOf('; '),
        slice.lastIndexOf(', '),
        slice.lastIndexOf(' '),
      ].filter((value) => value > maxChars * 0.55);

      if (candidates.length) {
        end = start + Math.max(...candidates) + 1;
      } else {
        const nextSpace = text.indexOf(' ', end);
        if (nextSpace > end && nextSpace - start < maxChars + 160) {
          end = nextSpace + 1;
        }
      }
    }

    const chunk = trimChunk(text, start, end);
    if (chunk) {
      chunks.push(chunk);
    }
    start = end;
  }

  return chunks;
}

