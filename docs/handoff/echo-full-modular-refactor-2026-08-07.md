# ECHO full modular refactor — 2026-08-07

## Intent

Refactor the entire ECHO speech/UI stack into clear ownership layers without changing product behavior.

## Before → after

| Surface | Before | After |
|---------|--------|-------|
| Edge Worker | monorepo `worker.js` (~580–1000) | `worker.js` router + `tts/stt/storage/parse/auth/http` |
| Hardline UI | `echo-reader.js` **2179 lines** | `echo-reader.js` entry + `app/config/profiles/text/state/files/surface/browser-voices` |
| Pages proxy | full durability logic | thin sample short-circuit + Worker authority |
| Docs | scattered handoffs | `ARCHITECTURE.md` + rewritten `README.md` |

## Deployed

- Worker version `a0f2f273-d4d5-4532-aae4-4566086bdc7c`
- Site Pages `76c9064b…`
- Live TTS matrix re-checked (echo + athena → 200 WAV)

## Out of scope (explicit)

- Expo screen split (already modular enough under frontend/src)
- Python backend modularization beyond current providers
- Named tunnel / Workers Paid
