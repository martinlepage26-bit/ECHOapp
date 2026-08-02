> **STALE — do not treat as current architecture.** This file describes the original
> `emergentintegrations`/OpenAI-only + MongoDB-via-Motor scaffold from before the
> `3e05016` Emergent decouple. It predates the `SPEECH_PROVIDER` abstraction (Piper
> default; `workers_ai`, `elevenlabs`, `openai`, local SpeechT5 clone as options),
> Cloudflare Workers AI, D1, and the local clone-voice provider.
>
> For current facts, read (in this order):
> - `PRODUCT.md` — brand, users, design principles (still current)
> - `docs/handoff/echo-workers-ai-2026-08-01.md` — live Workers AI wiring
> - `backend/speech_providers.py` — provider abstraction and defaults
> - `backend/clone_tts.py` — local SpeechT5 clone-voice provider
> - `workers/echo-ai/README.md` — the separate D1-backed full Cloudflare Workers stack
>
> This file is kept for historical record of the original product shape only.

# ECHO — Voice Reader & Dictation

A native Expo mobile app inspired by **martin.govern-ai.ca/echo/** — a browser-native voice reader. ECHO lets you listen to your drafts out loud with live word tracking, and record/import audio to transcribe on demand.

## Product Value
Writers, editors, students, and anyone reviewing a draft benefit from hearing their words back. Dictation closes the loop — capture a thought anywhere and receive a clean markdown transcript.

## Tech Stack
- **Frontend:** Expo Router (SDK 54), React Native, `expo-av` (playback + recording), `expo-document-picker`, `expo-clipboard`, `expo-sharing`, `expo-file-system`, `react-native-reanimated`
- **Backend:** FastAPI + Motor (async MongoDB)
- **Integrations:** OpenAI TTS `tts-1` and Whisper `whisper-1` via `emergentintegrations` (EMERGENT_LLM_KEY)
- **Document parsing:** `python-docx` (DOCX), `pypdf` (PDF), native UTF-8 (TXT/MD)

## Core Flows

### Readback (Text-to-Speech)
1. Import `.txt / .md / .docx / .pdf` via document picker **or** paste directly **or** load sample text
2. Pick one of 9 OpenAI voices (Alloy · Ash · Coral · Echo · Fable · Nova · Onyx · Sage · Shimmer)
3. Choose speed (0.75x / 1x / 1.25x / 1.5x)
4. Tap PLAY — backend returns base64 MP3 + per-word timing array (character-weighted estimate)
5. Live word-by-word highlighting syncs to playback (amber active; faded for past)
6. Pause / Stop controls with progress bar and timestamps

### Dictation (Speech-to-Text)
1. Tap the amber mic orb to start recording (pulse animation)
2. Tap again to stop — audio file is auto-uploaded to `/api/stt/transcribe`
3. Whisper returns transcript, rendered in a styled "Transcript Console" panel
4. COPY to clipboard (markdown-formatted) or EXPORT `.md` via native share sheet

## API Surface
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/voices` | List curated voices |
| GET | `/api/sample-text` | Sample content for quick start |
| POST | `/api/tts/generate` | Generate TTS audio + word timings |
| POST | `/api/stt/transcribe` | Transcribe uploaded audio (Whisper) |
| POST | `/api/parse-file` | Extract text from TXT/MD/DOCX/PDF |
| POST/GET | `/api/drafts` | Save / list drafts |
| POST/GET | `/api/transcripts` | Save / list transcripts |

## Design Language
Dark terminal/console aesthetic:
- Palette: `#0A0A0E` base, `#111116` surfaces, amber `#F5B841` accent, red `#EF4444` for record state
- Typography: mono (Menlo/monospace) for UI chrome, labels, timestamps; sans for body text
- No rounded corners, hairline borders, console-style prompts (`> microphone standby`)
- Bottom tab navigation (Readback / Dictation), thumb-friendly 44pt+ targets, safe-area insets

## Future Enhancements
- Draft library screen (list saved drafts from MongoDB)
- Transcript library with search
- Voice cloning (premium) once ElevenLabs paid plan available
- Word-accurate Whisper timestamps for richer readback highlighting
- Offline TTS fallback via `expo-speech`
