/** Browser-native speech synthesis for Google system voices. */

import { estimateWordTimings, type WordTiming } from "./timing.js";

let rafId: number | null = null;
let startTime = 0;
let activeWords: WordTiming[] = [];
let onWordCallback: ((index: number) => void) | null = null;
let onEndedCallback: (() => void) | null = null;
let onErrorCallback: ((error: Error) => void) | null = null;

export interface SystemVoice {
  id: string;
  name: string;
  provider: "system";
  lang: string;
  tag?: string;
  default: boolean;
}

function tick() {
  if (!window.speechSynthesis.speaking || !onWordCallback) {
    rafId = null;
    return;
  }
  const elapsed = (performance.now() - startTime) / 1000;
  const active = activeWords.findLast((w) => w.start <= elapsed);
  if (active) onWordCallback(active.index);
  rafId = requestAnimationFrame(tick);
}

function cleanup() {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  activeWords = [];
  onWordCallback = null;
  onEndedCallback = null;
  onErrorCallback = null;
}

export async function ensureVoicesLoaded(): Promise<void> {
  if (typeof window === "undefined" || !window.speechSynthesis) {
    throw new Error("Browser speech synthesis is not available.");
  }
  const voices = window.speechSynthesis.getVoices();
  if (voices.length > 0) return;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      window.speechSynthesis.onvoiceschanged = null;
      reject(new Error("Timed out waiting for system voices."));
    }, 5000);
    window.speechSynthesis.onvoiceschanged = () => {
      clearTimeout(timeout);
      window.speechSynthesis.onvoiceschanged = null;
      resolve();
    };
  });
}

export function getGoogleVoices(): SystemVoice[] {
  if (typeof window === "undefined" || !window.speechSynthesis) return [];
  const voices = window.speechSynthesis.getVoices();
  return voices
    .filter((v) => v.name.startsWith("Google"))
    .map((v) => ({
      id: v.name,
      name: v.name.replace(/^Google\s+/, ""),
      provider: "system" as const,
      lang: v.lang,
      tag: v.lang,
      default: v.default,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function speakSystem(
  text: string,
  voiceId: string,
  speed: number,
  onWord: (index: number) => void,
  onEnded?: () => void,
  onError?: (error: Error) => void,
): void {
  stopSystem();

  if (typeof window === "undefined" || !window.speechSynthesis) {
    onError?.(new Error("Browser speech synthesis is not available."));
    return;
  }

  const voices = window.speechSynthesis.getVoices();
  const voice = voices.find((v) => v.name === voiceId);
  if (!voice) {
    onError?.(new Error(`System voice '${voiceId}' not found.`));
    return;
  }

  const scaledSpeed = Math.max(0.5, Math.min(2, speed));
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.voice = voice;
  utterance.rate = scaledSpeed;
  utterance.pitch = 1;

  activeWords = estimateWordTimings(text).words.map((w) => ({
    ...w,
    start: Number((w.start / scaledSpeed).toFixed(3)),
    end: Number((w.end / scaledSpeed).toFixed(3)),
  }));
  onWordCallback = onWord;
  onEndedCallback = onEnded ?? null;
  onErrorCallback = onError ?? null;

  utterance.onstart = () => {
    startTime = performance.now();
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(tick);
  };

  utterance.onend = () => {
    if (onWordCallback) onWordCallback(-1);
    cleanup();
    onEndedCallback?.();
  };

  utterance.onerror = (event) => {
    cleanup();
    const err = new Error(`Speech synthesis error: ${event.error}`);
    onErrorCallback?.(err);
  };

  window.speechSynthesis.speak(utterance);
}

export function pauseSystem(): void {
  if (typeof window !== "undefined" && window.speechSynthesis) {
    window.speechSynthesis.pause();
  }
}

export function resumeSystem(): void {
  if (typeof window !== "undefined" && window.speechSynthesis) {
    window.speechSynthesis.resume();
  }
}

export function stopSystem(): void {
  if (typeof window !== "undefined" && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  cleanup();
}

export function isSystemSpeaking(): boolean {
  return typeof window !== "undefined" && window.speechSynthesis
    ? window.speechSynthesis.speaking && !window.speechSynthesis.paused
    : false;
}
