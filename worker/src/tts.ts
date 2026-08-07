/**
 * ECHO TTS — single explicit pipeline.
 *
 * A voice belongs to exactly one provider:
 *   - Aura voices  -> Cloudflare Workers AI (@cf/deepgram/aura-2-en)
 *   - Clone voices -> local clone sidecar (SpeechT5 / OpenVoice)
 *
 * No silent fallback between providers.
 */

export const DEFAULT_TTS_MODEL = "@cf/deepgram/aura-2-en";
export const DEFAULT_VOICE = "athena";
export const MAX_TTS_CHARS = 70_000;

// Deepgram Aura-2 hard-rejects over 2000 chars.
const PROVIDER_CHUNK_CHARS = 1900;
const CHUNK_CONCURRENCY = 4;

export interface Voice {
  id: string;
  name: string;
  provider: "workers_ai" | "clone";
  tag?: string;
}

export const AURA_VOICES: Voice[] = [
  { id: "athena", name: "Athena", provider: "workers_ai", tag: "clear · narration" },
  { id: "luna", name: "Luna", provider: "workers_ai", tag: "warm · soft" },
  { id: "orion", name: "Orion", provider: "workers_ai", tag: "deep · steady" },
  { id: "asteria", name: "Asteria", provider: "workers_ai", tag: "bright · expressive" },
  { id: "hera", name: "Hera", provider: "workers_ai", tag: "authoritative · news" },
  { id: "apollo", name: "Apollo", provider: "workers_ai", tag: "warm · male" },
  { id: "iris", name: "Iris", provider: "workers_ai", tag: "light · friendly" },
  { id: "andromeda", name: "Andromeda", provider: "workers_ai", tag: "smooth · storytelling" },
  { id: "arcas", name: "Arcas", provider: "workers_ai", tag: "calm · measured" },
  { id: "aries", name: "Aries", provider: "workers_ai", tag: "energetic · direct" },
  { id: "aurora", name: "Aurora", provider: "workers_ai", tag: "soft · contemplative" },
  { id: "cordelia", name: "Cordelia", provider: "workers_ai", tag: "refined · literary" },
  { id: "draco", name: "Draco", provider: "workers_ai", tag: "low · dramatic" },
  { id: "electra", name: "Electra", provider: "workers_ai", tag: "crisp · modern" },
  { id: "helena", name: "Helena", provider: "workers_ai", tag: "gentle · conversational" },
  { id: "hermes", name: "Hermes", provider: "workers_ai", tag: "quick · informative" },
  { id: "jupiter", name: "Jupiter", provider: "workers_ai", tag: "rich · broadcast" },
  { id: "mars", name: "Mars", provider: "workers_ai", tag: "firm · instructional" },
  { id: "odysseus", name: "Odysseus", provider: "workers_ai", tag: "story · epic" },
  { id: "orpheus", name: "Orpheus", provider: "workers_ai", tag: "musical · lyrical" },
  { id: "phoebe", name: "Phoebe", provider: "workers_ai", tag: "bright · youthful" },
  { id: "saturn", name: "Saturn", provider: "workers_ai", tag: "mature · grounded" },
  { id: "thalia", name: "Thalia", provider: "workers_ai", tag: "playful · light" },
  { id: "zeus", name: "Zeus", provider: "workers_ai", tag: "commanding · deep" },
];

export const CLONE_VOICES: Voice[] = [
  { id: "echo", name: "Echo", provider: "clone", tag: "sample · live" },
  { id: "patricia", name: "Patricia", provider: "clone", tag: "charming · clear · young" },
  { id: "martin-en", name: "Martin EN", provider: "clone", tag: "english · live" },
  { id: "martin-fr", name: "Martin FR", provider: "clone", tag: "français · live" },
];

const ALL_VOICES: Voice[] = [...CLONE_VOICES, ...AURA_VOICES];
const VOICE_BY_ID = new Map(ALL_VOICES.map((v) => [v.id, v]));

export function voiceCatalog(): Voice[] {
  return ALL_VOICES;
}

export function defaultVoiceId(): string {
  return DEFAULT_VOICE;
}

export function clampSpeed(speed: unknown): number {
  const n = Number(speed);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.max(0.5, Math.min(2, n));
}

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
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
  provider: "workers_ai" | "clone";
  speed: number;
  model: string;
}

async function audioResultToBytes(result: unknown): Promise<{ bytes: Uint8Array; mime: string }> {
  if (result instanceof ReadableStream) {
    const res = new Response(result);
    return { bytes: new Uint8Array(await res.arrayBuffer()), mime: "audio/mpeg" };
  }
  if (result instanceof ArrayBuffer) {
    return { bytes: new Uint8Array(result), mime: "audio/mpeg" };
  }
  if (ArrayBuffer.isView(result)) {
    return {
      bytes: new Uint8Array(result.buffer, result.byteOffset, result.byteLength),
      mime: "audio/mpeg",
    };
  }
  const r = result as Record<string, unknown> | null | undefined;
  if (r && typeof r.audio === "string") {
    return { bytes: decodeBase64(r.audio), mime: "audio/wav" };
  }
  if (r && r.audio instanceof ArrayBuffer) {
    return { bytes: new Uint8Array(r.audio), mime: "audio/mpeg" };
  }
  if (r && ArrayBuffer.isView(r.audio)) {
    const view = r.audio as ArrayBufferView;
    return {
      bytes: new Uint8Array(view.buffer, view.byteOffset, view.byteLength),
      mime: "audio/mpeg",
    };
  }
  throw new Error("Unknown audio payload shape from Workers AI.");
}

function buildWorkersAiInput(model: string, text: string, voice: string, speed: number) {
  if (model.includes("melotts")) {
    return { prompt: text, speaker: voice, speed };
  }
  return { text, speaker: voice, encoding: "mp3" };
}

export function chunkText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const chunks: string[] = [];
  let buf = "";
  for (const para of text.split("\n\n")) {
    const candidate = buf ? `${buf}\n\n${para}` : para;
    if (candidate.length <= maxChars) {
      buf = candidate;
      continue;
    }
    if (buf) {
      chunks.push(buf);
      buf = "";
    }
    if (para.length <= maxChars) {
      buf = para;
      continue;
    }
    let start = 0;
    while (start < para.length) {
      let end = Math.min(para.length, start + maxChars);
      if (end < para.length) {
        const window = para.slice(start, end);
        const cut = Math.max(
          window.lastIndexOf(". "),
          window.lastIndexOf("! "),
          window.lastIndexOf("? "),
          window.lastIndexOf(" "),
        );
        if (cut > maxChars * 0.4) end = start + cut + 1;
      }
      const piece = para.slice(start, end).trim();
      if (piece) chunks.push(piece);
      start = end;
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, c) => sum + c.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of parts) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

function isNeuronsExhausted(message: string): boolean {
  const m = String(message || "").toLowerCase();
  return m.includes("4006") || m.includes("neurons") || m.includes("daily free allocation");
}

async function synthesizeWorkersAi(
  env: Env,
  text: string,
  voice: Voice,
  speed: number,
): Promise<SynthesisResult> {
  const model = (env.ECHO_TTS_MODEL || DEFAULT_TTS_MODEL).trim();
  const raw = await env.AI.run(model, buildWorkersAiInput(model, text, voice.id, speed));
  const { bytes, mime } = await audioResultToBytes(raw);
  if (!bytes.byteLength) throw new Error("Workers AI returned empty audio.");
  return { bytes, mime, voice_id: voice.id, provider: "workers_ai", speed, model };
}

async function synthesizeLongWorkersAi(
  env: Env,
  text: string,
  voice: Voice,
  speed: number,
): Promise<SynthesisResult> {
  const pieces = chunkText(text, PROVIDER_CHUNK_CHARS);
  if (pieces.length === 1) return synthesizeWorkersAi(env, text, voice, speed);

  const results = await mapWithConcurrency(pieces, CHUNK_CONCURRENCY, (piece) =>
    synthesizeWorkersAi(env, piece, voice, speed),
  );
  const first = results[0];
  return {
    bytes: concatBytes(results.map((r) => r.bytes)),
    mime: first.mime,
    voice_id: first.voice_id,
    provider: "workers_ai",
    speed: first.speed,
    model: first.model,
  };
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
  const voice = VOICE_BY_ID.get(raw) || AURA_VOICES.find((v) => v.id === raw) || AURA_VOICES[0];
  if (!voice) throw new Error("No voices configured.");

  if (voice.provider === "clone") {
    return synthesizeClone(env, text, voice, speed);
  }
  return synthesizeLongWorkersAi(env, text, voice, speed);
}

export function humanizeTtsError(error: unknown): { detail: string; code: string } {
  const message = String((error as Error)?.message || error).slice(0, 400);
  if (isNeuronsExhausted(message)) {
    return {
      code: "workers_ai_quota_exhausted",
      detail:
        "Cloudflare Workers AI free neurons are exhausted for today. " +
        `Original: ${message}`,
    };
  }
  if (message.includes("ECHO_CLONE_TTS_URL")) {
    return { code: "clone_unavailable", detail: message };
  }
  if (message.includes("Clone TTS") || message.includes("Clone sidecar unreachable")) {
    return { code: "clone_unavailable", detail: message };
  }
  return { code: "tts_failed", detail: message };
}
