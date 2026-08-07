/** Audio playback with word-highlight timing. */

export interface WordTiming {
  word: string;
  start: number;
  end: number;
  index: number;
}

let currentAudio: HTMLAudioElement | null = null;
let rafId: number | null = null;

export function playAudio(
  base64: string,
  mime: string,
  words: WordTiming[],
  onWord: (index: number) => void,
  onEnded?: () => void,
): HTMLAudioElement {
  stopAudio();

  const audio = new Audio(`data:${mime};base64,${base64}`);
  currentAudio = audio;

  const update = () => {
    const time = audio.currentTime;
    const active = words.findLast((w) => w.start <= time);
    if (active) onWord(active.index);
    if (!audio.paused && !audio.ended) {
      rafId = requestAnimationFrame(update);
    }
  };

  audio.addEventListener("play", () => {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(update);
  });

  audio.addEventListener("pause", () => {
    if (rafId) cancelAnimationFrame(rafId);
  });

  audio.addEventListener("ended", () => {
    if (rafId) cancelAnimationFrame(rafId);
    onWord(-1);
    onEnded?.();
  });

  audio.play().catch(() => {});
  return audio;
}

export function pauseAudio(): void {
  currentAudio?.pause();
}

export function resumeAudio(): void {
  currentAudio?.play().catch(() => {});
}

export function stopAudio(): void {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
  }
}

export function isPlaying(): boolean {
  return !!currentAudio && !currentAudio.paused && !currentAudio.ended;
}
