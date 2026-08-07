/** ONE HTTP client for the ECHO UI. */

const API_KEY = import.meta.env.VITE_ECHO_API_KEY || "";

export interface Voice {
  id: string;
  name: string;
  provider: "workers_ai" | "clone";
  tag?: string;
}

export interface TtsResult {
  audio_base64: string;
  mime: string;
  voice_id: string;
  provider: "workers_ai" | "clone";
  word_count: number;
  char_count: number;
  words: Array<{ word: string; start: number; end: number; index: number }>;
  estimated_duration: number;
}

export interface Draft {
  id: string;
  title: string;
  text: string;
  created_at: string;
}

export interface ParsedFile {
  text: string;
  word_count: number;
  char_count: number;
  filename: string;
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (API_KEY) h["X-Echo-Key"] = API_KEY;
  return h;
}

async function handleError(res: Response): Promise<never> {
  const body = await res.json().catch(() => ({ detail: res.statusText }));
  throw new Error(body.detail || `HTTP ${res.status}`);
}

export async function fetchVoices(): Promise<{ voices: Voice[]; default: string }> {
  const res = await fetch("/api/voices");
  if (!res.ok) await handleError(res);
  return res.json();
}

export async function fetchSampleText(): Promise<string> {
  const res = await fetch("/api/sample-text");
  if (!res.ok) await handleError(res);
  const body = (await res.json()) as { text: string };
  return body.text;
}

export async function synthesize(text: string, voiceId: string, speed: number): Promise<TtsResult> {
  const res = await fetch("/api/tts", {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ text, voice_id: voiceId, speed }),
  });
  if (!res.ok) await handleError(res);
  return res.json();
}

export async function parseFile(file: File): Promise<ParsedFile> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/parse", {
    method: "POST",
    headers: API_KEY ? { "X-Echo-Key": API_KEY } : {},
    body: form,
  });
  if (!res.ok) await handleError(res);
  return res.json();
}

export async function listDrafts(): Promise<Draft[]> {
  const res = await fetch("/api/drafts", { headers: API_KEY ? { "X-Echo-Key": API_KEY } : {} });
  if (!res.ok) await handleError(res);
  return res.json();
}

export async function createDraft(title: string, text: string): Promise<Draft> {
  const res = await fetch("/api/drafts", {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ title, text }),
  });
  if (!res.ok) await handleError(res);
  return res.json();
}

export async function deleteDraft(id: string): Promise<void> {
  const res = await fetch(`/api/drafts/${id}`, {
    method: "DELETE",
    headers: API_KEY ? { "X-Echo-Key": API_KEY } : {},
  });
  if (!res.ok) await handleError(res);
}
