/**
 * ECHO TTS — clone voices only.
 *
 * System voices (Google / browser-native) are synthesized client-side.
 * Clone voices route to the local clone sidecar.
 */

export const DEFAULT_VOICE = "echo";
export const MAX_TTS_CHARS = 70_000;

export interface Voice {
  id: string;
  name: string;
  provider: "clone";
  tag?: string;
}

export const CLONE_VOICES: Voice[] = [
  { id: "echo", name: "Echo", provider: "clone", tag: "sample · live" },
  { id: "patricia", name: "Patricia", provider: "clone", tag: "charming · clear · young" },
  { id: "martin-en", name: "Martin EN", provider: "clone", tag: "english · live" },
  { id: "martin-fr", name: "Martin FR", provider: "clone", tag: "français · live" },
];

const VOICE_BY_ID = new Map(CLONE_VOICES.map((v) => [v.id, v]));

export function voiceCatalog(): Voice[] {
  return CLONE_VOICES;
}

export function defaultVoiceId(): string {
  return DEFAULT_VOICE;
}

export function clampSpeed(speed: unknown): number {
  const n = Number(speed);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.max(0.5, Math.min(2, n));
}

export function encodeBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return btoa(binary);
}

export interface WordTiming {
  word: string;
  start: number;
  end: number;
  index: number;
}

export interface TimingResult {
  words: WordTiming[];
  estimated_duration: number;
}

export function estimateWordTimings(text: string): TimingResult {
  const tokens = String(text || "").match(/\S+/g) || [];
  let cursor = 0;
  const words = tokens.map((word, index) => {
    const core = word.replace(/^[^\w]+|[^\w]+$/g, "");
    let duration = 0.12 + Math.min(core.length || 1, 16) * 0.028;
    if (/\d/.test(core)) duration += 0.08;
    if (/\.\.\.$|…$/.test(word)) duration += 0.28;
    else if (/[.!?]$/.test(word)) duration += 0.18;
    else if (/[,;:]$/.test(word)) duration += 0.09;
    const start = Number(cursor.toFixed(3));
    cursor += duration;
    return { word, start, end: Number(cursor.toFixed(3)), index };
  });
  return { words, estimated_duration: Number(cursor.toFixed(3)) };
}

export interface SynthesisResult {
  bytes: Uint8Array;
  mime: string;
  voice_id: string;
  provider: "clone";
  speed: number;
  model: string;
}

async function synthesizeClone(
  env: Env,
  text: string,
  voice: Voice,
  speed: number,
): Promise<SynthesisResult> {
  const cloneBase = String(env.ECHO_CLONE_TTS_URL || "").trim().replace(/\/+$/, "");
  if (!cloneBase) {
    throw new Error("Clone voice requested but ECHO_CLONE_TTS_URL is not set on the Worker.");
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const key = String(env.ECHO_API_KEY || "").trim();
  if (key) headers["X-Echo-Key"] = key;

  let res: Response;
  try {
    res = await fetch(`${cloneBase}/tts`, {
      method: "POST",
      headers,
      body: JSON.stringify({ text, voice_id: voice.id, speed }),
    });
  } catch (fetchError) {
    throw new Error(
      `Clone sidecar unreachable at ${cloneBase}: ${String((fetchError as Error)?.message || fetchError)}`,
    );
  }

  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    if (res.status === 401) throw new Error(`Clone TTS rejected the API key.`);
    if (res.status === 404) throw new Error(`Clone voice '${voice.id}' not found on sidecar.`);
    throw new Error(`Clone TTS HTTP ${res.status}: ${detail}`);
  }

  const bytes = new Uint8Array(await res.arrayBuffer());
  if (!bytes.byteLength) throw new Error("Clone TTS returned empty audio.");
  return {
    bytes,
    mime: res.headers.get("Content-Type") || "audio/wav",
    voice_id: voice.id,
    provider: "clone",
    speed,
    model: "speechT5-clone",
  };
}

export async function synthesize(
  env: Env,
  text: string,
  voiceId: string,
  speed: number,
): Promise<SynthesisResult> {
  const raw = String(voiceId || "").trim().toLowerCase();
  const voice = VOICE_BY_ID.get(raw);
  if (!voice) throw new Error(`Clone voice '${voiceId}' not found.`);
  return synthesizeClone(env, text, voice, speed);
}

export function humanizeTtsError(error: unknown): { detail: string; code: string } {
  const message = String((error as Error)?.message || error).slice(0, 400);
  if (message.includes("ECHO_CLONE_TTS_URL")) {
    return { code: "clone_unavailable", detail: message };
  }
  if (message.includes("Clone TTS") || message.includes("Clone sidecar unreachable")) {
    return { code: "clone_unavailable", detail: message };
  }
  return { code: "tts_failed", detail: message };
}
