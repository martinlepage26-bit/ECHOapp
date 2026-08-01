import { Platform } from 'react-native';

// Empty means same-origin: the backend serves this bundle, so `/api` resolves against
// whatever host the page was loaded from. That keeps one URL and sidesteps CORS entirely.
const BASE = process.env.EXPO_PUBLIC_BACKEND_URL ?? '';
export const API_BASE = `${BASE}/api`;

export type Voice = { id: string; name: string; tag: string };
export type WordTiming = { word: string; start: number; end: number; index: number };
export type TTSResponse = {
  audio_base64: string;
  mime: string;
  voice_id: string;
  word_count: number;
  char_count: number;
  words: WordTiming[];
  estimated_duration: number;
};
export type STTResponse = {
  id: string;
  transcript: string;
  created_at: string;
  duration?: number | null;
};
export type DraftRow = {
  id: string;
  title: string;
  text: string;
  created_at: string;
};
export type TranscriptRow = {
  id: string;
  text: string;
  duration?: number | null;
  created_at: string;
};
export type ParseFileResponse = {
  text: string;
  filename: string;
  word_count: number;
  char_count: number;
};

type UploadPayload = {
  uri: string;
  filename: string;
  mime: string;
  webFile?: Blob | File | null;
};

// Shared gate for TTS/STT/parse-file and drafts/transcripts. Empty in local dev (backend
// leaves the gate open). Required on a public URL. This value is compiled into the web
// bundle — treat as rate-limit friction, not a private user secret.
const ECHO_KEY = process.env.EXPO_PUBLIC_ECHO_KEY ?? '';

export function authHeaders(extra?: Record<string, string>): Record<string, string> {
  return ECHO_KEY ? { ...(extra ?? {}), 'X-Echo-Key': ECHO_KEY } : { ...(extra ?? {}) };
}

async function jfetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: authHeaders(init?.headers as Record<string, string> | undefined),
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      detail = j?.detail || detail;
    } catch {}
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
  }
  return (await res.json()) as T;
}

async function buildUploadForm(field: string, payload: UploadPayload): Promise<FormData> {
  const form = new FormData();
  if (Platform.OS === 'web') {
    const blob = payload.webFile ?? (await fetchBlobFromUri(payload.uri));
    form.append(field, blob, payload.filename);
    return form;
  }

  form.append(
    field,
    // React Native uses a different FormData file shape than browsers.
    { uri: payload.uri, name: payload.filename, type: payload.mime } as any
  );
  return form;
}

async function fetchBlobFromUri(uri: string): Promise<Blob> {
  const res = await fetch(uri);
  if (!res.ok) {
    throw new Error(`Could not read local file for upload (HTTP ${res.status}).`);
  }
  return await res.blob();
}

export const api = {
  getVoices: () => jfetch<{ voices: Voice[]; default: string }>('/voices'),
  getSampleText: () => jfetch<{ text: string }>('/sample-text'),

  generateTTS: (text: string, voice_id: string, speed: number = 1.0) =>
    jfetch<TTSResponse>('/tts/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice_id, speed }),
    }),

  transcribe: async (uri: string, filename: string, mime: string, webFile?: Blob | File | null) => {
    const form = await buildUploadForm('audio', { uri, filename, mime, webFile });
    const res = await fetch(`${API_BASE}/stt/transcribe`, {
      method: 'POST',
      headers: authHeaders(),
      body: form,
    });
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const j = await res.json();
        detail = j?.detail || detail;
      } catch {}
      throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
    }
    return (await res.json()) as STTResponse;
  },

  listDrafts: () => jfetch<DraftRow[]>('/drafts'),
  saveDraft: (title: string, text: string) =>
    jfetch<DraftRow>('/drafts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, text }),
    }),
  deleteDraft: (id: string) =>
    jfetch<{ deleted: number; id: string }>(`/drafts/${id}`, { method: 'DELETE' }),

  listTranscripts: () => jfetch<TranscriptRow[]>('/transcripts'),
  deleteTranscript: (id: string) =>
    jfetch<{ deleted: number; id: string }>(`/transcripts/${id}`, { method: 'DELETE' }),

  parseFile: async (uri: string, filename: string, mime: string, webFile?: Blob | File | null) => {
    const form = await buildUploadForm('file', { uri, filename, mime, webFile });
    const res = await fetch(`${API_BASE}/parse-file`, {
      method: 'POST',
      headers: authHeaders(),
      body: form,
    });
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const j = await res.json();
        detail = j?.detail || detail;
      } catch {}
      throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
    }
    return (await res.json()) as ParseFileResponse;
  },
};
