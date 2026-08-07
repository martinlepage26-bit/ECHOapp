/** Hardline ECHO constants and endpoints. */

export const SAMPLE_TEXT =
  'ECHO is a browser-native reading surface for listening to drafts out loud. Paste text or import a document, choose a voice profile, and hear the language back with live word tracking.';

export const STORAGE_KEY = 'echo-reader-state-v1';
export const VOICE_POLL_INTERVAL_MS = 700;
export const VOICE_POLL_MAX_ATTEMPTS = 12;
export const PREVIEW_RENDER_DEBOUNCE_MS = 80;
export const DEFAULT_SURFACE_BATCH_SIZE = 420;
export const LARGE_SURFACE_BATCH_SIZE = 240;
export const LARGE_DRAFT_WORD_THRESHOLD = 4000;
export const HIGHLIGHT_SCROLL_THROTTLE_MS = 140;
export const DICTATION_ENDPOINT = '/api/echo-transcribe';
/** Same-origin Pages Function → Cloudflare Workers AI (echo-ai). */
export const TTS_ENDPOINT = '/api/echo-tts';
export const ONLINE_TTS_MAX_CHARS = 4000;
export const ONLINE_TTS_VOICE = 'athena';
export const DICTATION_TIMESLICE_MS = 250;
export const DICTATION_PLACEHOLDER = [
  '> microphone standby',
  '> press Record to capture',
  '> export as markdown when ready',
].join('\n');
export const RECORDING_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
];
export const NORMALIZED_TRANSCRIPTION_SAMPLE_RATE = 16000;

export const SUPPORTED_EXTENSIONS = new Set(['txt', 'md', 'markdown', 'docx', 'pdf']);
export const TEXT_EXTENSIONS = new Set(['txt', 'md', 'markdown']);
export const DOCX_EXTENSIONS = new Set(['docx']);
export const PDF_EXTENSIONS = new Set(['pdf']);
export const ECHO_PROFILE_ID = 'echo';
export const SYSTEM_PROFILE_ID = 'system';
export const ECHO_PROFILE_SUMMARY = 'Sample-backed neural readback (no ElevenLabs API).';
/** Sample profiles that synthesize any draft via /api/echo-tts. */
export const CLONE_VOICE_IDS = new Set(['echo', 'patricia', 'martin-en', 'martin-fr']);
