import type { WordTiming } from './api';

/** Build a playable URI from base64 TTS audio. On web uses Blob object URLs (no data: size cap). */
export function makePlayableAudioUri(
  audioBase64: string,
  mime: string,
  opts: {
    isWeb: boolean;
    revokePrevious: () => void;
    trackObjectUrl: (url: string) => void;
  }
): string {
  opts.revokePrevious();

  if (!opts.isWeb) {
    return `data:${mime};base64,${audioBase64}`;
  }

  const binary = atob(audioBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: mime || 'audio/mpeg' });
  const url = URL.createObjectURL(blob);
  opts.trackObjectUrl(url);
  return url;
}

export function formatPlaybackError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : String(error || '');
  if (/NotAllowedError|user gesture|autoplay/i.test(message)) {
    return fallback;
  }
  return message || fallback;
}

export function scaleWordTimings(
  words: WordTiming[],
  estimatedDuration: number,
  actualDurationMs: number
): WordTiming[] {
  if (!words.length) return words;
  const actualDuration = actualDurationMs > 0 ? actualDurationMs / 1000 : 0;
  if (!estimatedDuration || !actualDuration) return words;

  const scale = actualDuration / estimatedDuration;
  if (!isFinite(scale) || Math.abs(scale - 1) < 0.04) return words;

  return words.map((word) => ({
    ...word,
    start: Number((word.start * scale).toFixed(3)),
    end: Number((word.end * scale).toFixed(3)),
  }));
}

export function fmtMs(ms: number): string {
  if (!isFinite(ms) || ms <= 0) return '00:00';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}
