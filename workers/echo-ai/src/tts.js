/**
 * ECHO TTS: Workers AI (Aura) with SpeechT5-clone fallback.
 * Single ownership of voice catalog, Aura↔sample maps, and durable synthesis.
 */

export const DEFAULT_TTS_MODEL = "@cf/deepgram/aura-2-en";
export const DEFAULT_VOICE = "athena";
// ~10k words with headroom; per-call cap is PROVIDER_CHUNK_CHARS.
export const MAX_TTS_CHARS = 70_000;
// Deepgram Aura-2 hard-rejects over 2000 chars (error 8007).
const PROVIDER_CHUNK_CHARS = 1900;
const CHUNK_CONCURRENCY = 4;

/** Aura-2 English speakers with short UI tags (name · style). */
export const AURA_VOICES = [
  { id: "athena", name: "Athena", tag: "clear · narration" },
  { id: "luna", name: "Luna", tag: "warm · soft" },
  { id: "orion", name: "Orion", tag: "deep · steady" },
  { id: "asteria", name: "Asteria", tag: "bright · expressive" },
  { id: "hera", name: "Hera", tag: "authoritative · news" },
  { id: "apollo", name: "Apollo", tag: "warm · male" },
  { id: "iris", name: "Iris", tag: "light · friendly" },
  { id: "andromeda", name: "Andromeda", tag: "smooth · storytelling" },
  { id: "arcas", name: "Arcas", tag: "calm · measured" },
  { id: "aries", name: "Aries", tag: "energetic · direct" },
  { id: "aurora", name: "Aurora", tag: "soft · contemplative" },
  { id: "cordelia", name: "Cordelia", tag: "refined · literary" },
  { id: "draco", name: "Draco", tag: "low · dramatic" },
  { id: "electra", name: "Electra", tag: "crisp · modern" },
  { id: "helena", name: "Helena", tag: "gentle · conversational" },
  { id: "hermes", name: "Hermes", tag: "quick · informative" },
  { id: "jupiter", name: "Jupiter", tag: "rich · broadcast" },
  { id: "mars", name: "Mars", tag: "firm · instructional" },
  { id: "odysseus", name: "Odysseus", tag: "story · epic" },
  { id: "orpheus", name: "Orpheus", tag: "musical · lyrical" },
  { id: "phoebe", name: "Phoebe", tag: "bright · youthful" },
  { id: "saturn", name: "Saturn", tag: "mature · grounded" },
  { id: "thalia", name: "Thalia", tag: "playful · light" },
  { id: "zeus", name: "Zeus", tag: "commanding · deep" },
];

/**
 * Hardline /echo sample profiles. `aura` is the Workers AI speaker when clone is down.
 */
export const SAMPLE_VOICES = [
  { id: "echo", name: "Echo", tag: "sample · live", aura: "athena" },
  { id: "patricia", name: "Patricia", tag: "charming · clear · young", aura: "luna" },
  { id: "martin-en", name: "Martin EN", tag: "english · live", aura: "orion" },
  { id: "martin-fr", name: "Martin FR", tag: "français · live", aura: "apollo" },
];

const SAMPLE_TO_AURA = Object.fromEntries(SAMPLE_VOICES.map((v) => [v.id, v.aura]));
const SAMPLE_IDS = new Set(SAMPLE_VOICES.map((v) => v.id));

/** Inverse of SAMPLE_TO_AURA plus remaining Aura ids → a speakable clone profile. */
const AURA_TO_SAMPLE = {
  athena: "echo",
  luna: "patricia",
  orion: "martin-en",
  apollo: "martin-fr",
  asteria: "echo",
  hera: "patricia",
  iris: "patricia",
  helena: "patricia",
  andromeda: "echo",
  cordelia: "echo",
  phoebe: "echo",
  thalia: "echo",
  aurora: "echo",
  electra: "echo",
  arcas: "martin-en",
  aries: "martin-en",
  draco: "martin-en",
  jupiter: "martin-en",
  mars: "martin-en",
  odysseus: "martin-en",
  orpheus: "martin-en",
  saturn: "martin-en",
  zeus: "martin-en",
  hermes: "martin-en",
};

function parseCsv(raw) {
  return String(raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function voiceCatalog(env) {
  const configured = parseCsv(env.ECHO_TTS_VOICES);
  const aura = configured.length
    ? configured.map((id) => {
        const known = AURA_VOICES.find((v) => v.id === id);
        return known || { id, name: id, tag: "workers ai · aura" };
      })
    : AURA_VOICES;
  return [
    ...SAMPLE_VOICES.map(({ id, name, tag }) => ({ id, name, tag })),
    ...aura.filter((v) => !SAMPLE_IDS.has(v.id)),
  ];
}

export function defaultVoiceId(env, catalog) {
  const preferred = (env.ECHO_DEFAULT_VOICE || DEFAULT_VOICE).trim();
  if (catalog.some((v) => v.id === preferred)) return preferred;
  if (catalog.some((v) => v.id === "echo")) return "echo";
  return catalog[0]?.id || DEFAULT_VOICE;
}

function resolveAuraVoiceId(voiceId, catalog, env) {
  const raw = String(voiceId || "").trim().toLowerCase();
  if (SAMPLE_TO_AURA[raw]) return SAMPLE_TO_AURA[raw];
  if (AURA_VOICES.some((v) => v.id === raw) && catalog.some((v) => v.id === raw)) {
    return raw;
  }
  const fallback = defaultVoiceId(env, catalog);
  return SAMPLE_TO_AURA[fallback] || fallback;
}

/** Map any UI/Aura id onto a SpeechT5 sample the clone origin can render. */
export function mapVoiceForClone(voiceId) {
  const raw = String(voiceId || "").trim().toLowerCase();
  if (SAMPLE_IDS.has(raw)) return raw;
  return AURA_TO_SAMPLE[raw] || "echo";
}

export function clampSpeed(speed) {
  const n = Number(speed);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.max(0.5, Math.min(2, n));
}

function decodeBase64(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function encodeBase64(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return btoa(binary);
}

export function estimateWordTimings(text) {
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

async function audioResultToBytes(result) {
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
  if (result && typeof result.audio === "string") {
    return { bytes: decodeBase64(result.audio), mime: "audio/wav" };
  }
  if (result && result.audio instanceof ArrayBuffer) {
    return { bytes: new Uint8Array(result.audio), mime: "audio/mpeg" };
  }
  if (result && ArrayBuffer.isView(result.audio)) {
    const view = result.audio;
    return {
      bytes: new Uint8Array(view.buffer, view.byteOffset, view.byteLength),
      mime: "audio/mpeg",
    };
  }
  throw new Error("Unknown audio payload shape from Workers AI.");
}

function buildTtsInput(model, text, voice, speed) {
  if (model.includes("melotts")) {
    return { prompt: text, speaker: voice, speed };
  }
  return { text, speaker: voice, encoding: "mp3" };
}

/** Split text into <=maxChars pieces (paragraph → sentence → whitespace). */
export function chunkText(text, maxChars) {
  if (text.length <= maxChars) return [text];
  const chunks = [];
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

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
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

function concatBytes(parts) {
  const total = parts.reduce((sum, c) => sum + c.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of parts) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

function isNeuronsExhausted(message) {
  const m = String(message || "").toLowerCase();
  return m.includes("4006") || m.includes("neurons") || m.includes("daily free allocation");
}

export function humanizeTtsError(primary, secondary) {
  const main = String(primary || "TTS failed").slice(0, 280);
  const extra = secondary ? ` Clone fallback: ${String(secondary).slice(0, 160)}` : "";
  if (isNeuronsExhausted(main)) {
    return (
      "Cloudflare Workers AI free neurons are exhausted for today. " +
      "Clone fallback was unavailable or also failed." +
      extra +
      ` Original: ${main}`
    );
  }
  return (main + extra).slice(0, 400);
}

async function synthesizeWorkersAi(env, text, voiceId, speed) {
  const catalog = voiceCatalog(env);
  const model = (env.ECHO_TTS_MODEL || DEFAULT_TTS_MODEL).trim();
  const requested =
    catalog.find((v) => v.id === String(voiceId || "").trim().toLowerCase())?.id ||
    String(voiceId || "").trim().toLowerCase() ||
    defaultVoiceId(env, catalog);
  const auraVoice = resolveAuraVoiceId(requested, catalog, env);
  const applied = clampSpeed(speed);
  const raw = await env.AI.run(model, buildTtsInput(model, text, auraVoice, applied));
  const { bytes, mime } = await audioResultToBytes(raw);
  if (!bytes.byteLength) throw new Error("Workers AI returned empty audio.");
  return {
    bytes,
    mime,
    voice: requested,
    auraVoice,
    applied,
    model,
    backend: "workers_ai",
  };
}

async function synthesizeLongWorkersAi(env, text, voiceId, speed) {
  const pieces = chunkText(text, PROVIDER_CHUNK_CHARS);
  if (pieces.length === 1) return synthesizeWorkersAi(env, text, voiceId, speed);
  const results = await mapWithConcurrency(pieces, CHUNK_CONCURRENCY, (piece) =>
    synthesizeWorkersAi(env, piece, voiceId, speed),
  );
  const first = results[0];
  return {
    bytes: concatBytes(results.map((r) => r.bytes)),
    mime: first.mime,
    voice: first.voice,
    applied: first.applied,
    model: first.model,
    backend: "workers_ai",
  };
}

async function synthesizeViaClone(env, text, voiceId, speed) {
  const cloneBase = String(env.ECHO_CLONE_TTS_URL || "").trim().replace(/\/+$/, "");
  if (!cloneBase) {
    throw new Error("ECHO_CLONE_TTS_URL is not set on the Worker.");
  }
  const cloneVoice = mapVoiceForClone(voiceId);
  const applied = clampSpeed(speed);
  const headers = { "Content-Type": "application/json" };
  const key = String(env.ECHO_API_KEY || "").trim();
  if (key) {
    headers["X-Echo-Key"] = key;
    headers.Authorization = `Bearer ${key}`;
  }
  const res = await fetch(`${cloneBase}/api/tts/raw`, {
    method: "POST",
    headers,
    body: JSON.stringify({ text, voice_id: cloneVoice, speed: applied }),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    throw new Error(`Clone TTS HTTP ${res.status}: ${detail}`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (!bytes.byteLength) throw new Error("Clone TTS returned empty audio.");
  return {
    bytes,
    mime: res.headers.get("Content-Type") || "audio/wav",
    voice: cloneVoice,
    auraVoice: cloneVoice,
    applied,
    model: "speechT5-clone",
    backend: "clone",
  };
}

/**
 * Durable TTS: Workers AI first; on any failure, SpeechT5 clone via ECHO_CLONE_TTS_URL.
 */
export async function synthesizeLong(env, text, voiceId, speed) {
  try {
    return await synthesizeLongWorkersAi(env, text, voiceId, speed);
  } catch (aiError) {
    try {
      return await synthesizeViaClone(env, text, voiceId, speed);
    } catch (cloneError) {
      throw new Error(
        humanizeTtsError(aiError?.message || aiError, cloneError?.message || cloneError),
      );
    }
  }
}

export function backendLabel(result) {
  return result?.backend === "clone" ? "SpeechT5-clone" : "Cloudflare Workers AI";
}
