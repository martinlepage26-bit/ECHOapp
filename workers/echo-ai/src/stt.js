/** Whisper STT via Workers AI. */
import { encodeBase64 } from "./tts.js";

const DEFAULT_STT_MODEL = "@cf/openai/whisper-large-v3-turbo";
export const MAX_STT_BYTES = 24 * 1024 * 1024;

export async function transcribe(env, audioBytes, filename) {
  const model = (env.ECHO_STT_MODEL || DEFAULT_STT_MODEL).trim();
  const result = await env.AI.run(model, {
    audio: encodeBase64(audioBytes),
    task: "transcribe",
    vad_filter: true,
    condition_on_previous_text: false,
  });
  const text = String(result?.text || "").trim();
  if (!text) throw new Error("Transcription returned no text.");
  return { text, model, filename };
}

export async function readMultipartAudio(request) {
  const contentType = request.headers.get("Content-Type") || "";
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("audio") || form.get("file");
    if (!file || typeof file === "string") {
      throw new Error('Multipart field "audio" is required.');
    }
    const buf = new Uint8Array(await file.arrayBuffer());
    return { bytes: buf, filename: file.name || "capture.webm" };
  }
  const buf = new Uint8Array(await request.arrayBuffer());
  const filename = request.headers.get("X-Echo-Filename") || "capture.webm";
  return { bytes: buf, filename };
}
