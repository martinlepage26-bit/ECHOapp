# ECHO architecture

The active application is a Vite/React reader in `src/` and a Cloudflare Worker in `worker/index.js`. Vite builds static assets under the `/echo/` base. The Worker strips the mount before passing asset requests to its `ASSETS` binding.

## Ownership

| Path | Responsibility |
| --- | --- |
| `src/pages/Home.jsx` | Intake, shortcuts, dialogs and controls |
| `src/hooks/useSpeech.js` | Voice selection, cancellation, pause/resume and sentence progress |
| `src/lib/sentences.js` | Source-preserving sentence segmentation and bounded utterances |
| `src/lib/verbalize.js`, `numbers.js`, `dictionaries.js` | English/French pronunciation without changing visible source text |
| `src/lib/language.js` | Heuristic language suggestion |
| `src/lib/importFile.js`, `zip.js` | In-browser document extraction |
| `src/lib/drafts.js` | Browser-local draft storage |
| `worker/index.js` | Static assets and public URL extraction |
| `src/lib/pharosVoice.js` | Short opening phrase, bounded lookahead and cancel-safe Web Audio playback |
| `companion/server.py` | Local reader, strict Origin/Host guards and adapter to the existing PHAROS voice service |
| `test/` | Segmentation, pronunciation and Worker route tests |

There is no application account, cloud speech endpoint or draft database in this build. Browser-provided online voices may still send text to their providers. Local file parsing does not upload files. URL import calls the same-origin Worker; it is a network operation.

## Playback

The hook speaks one sentence at a time, including number substitutions when enabled. Source offsets and visible text remain intact. Sentence progress is estimated; it is not word-boundary alignment. Generation IDs invalidate canceled runs. Long unpunctuated passages split at soft boundaries around 400 characters. The UI retains the governed reader's sentence navigation instead of Base44's separate utterance per word.

## Local PHAROS adapter

The optional companion binds only `127.0.0.1:8787`. Exact allowed browser origins
are `http://127.0.0.1:8787`, `http://localhost:8787`, and
`https://martin.govern-ai.ca`. There is no wildcard CORS, authentication bypass,
public tunnel, or application account. POST requires JSON and the non-secret
`X-Echo-Client` request header, excluding simple cross-site forms. Host checks
reject rebinding; untrusted origins are rejected before inference. A maximum of
three admitted requests and 80 characters per clip bound pending work.

The companion verifies PHAROS's reference SHA-256 and calls the existing
`http://127.0.0.1:8765/speak` with text only. It reads only a user-owned regular
`echosay-*.wav` in a system temp directory, validates 24 kHz mono PCM16, returns
audio bytes, and removes that temporary file. An in-memory LRU holds at most
32 MiB; its key includes text and installed service/reference identity. Cache
access has its own lock so a hit bypasses unrelated rendering and a full queue.
Waiting requests check for a disconnected caller before acquiring the model
lock and again before synthesis; already-started inference can still finish.
PHAROS's
resident model serializes inference; this adapter creates no agent executor,
queue daemon, microphone owner or model process.

The browser resumes its own AudioContext on the Play gesture. The first phrase
is at most 24 characters, followed by clips of at most 48 characters. It renders
and decodes one next clip during current playback, including across sentence
boundaries. Lookahead stops at that one clip while paused; prefetch failures
surface after current playback rather than cutting it off. Progress comes from
actual decoded audio duration. Generation IDs
and abort signals suppress stale replies after Stop or seek. English-only
PHAROS mode never falls back silently to browser speech. Existing browser voice
behavior is retained. URL import in the local reader forwards only to the
existing governed extraction endpoint.

## Deployment

`wrangler.toml` targets Worker `echo` on `martin.govern-ai.ca/echo` and `martin.govern-ai.ca/echo/*`. The website repository does not build this source. Do not run its old sibling-directory ECHO sync command to publish this app. An authorized deployment uses `npm run deploy` here; CI runs checks and build only.

The URL extractor rejects common private/loopback/metadata literals and checks redirects. These checks are not proof of DNS-rebinding protection or a complete security audit. Cloudflare networking behavior and authenticated/private-page imports are outside this reconciliation's verification scope.

## Provenance

See `docs/reconciliation/2026-10-17.md` and the six-file hash receipt. The imported stable source is separate from unfinished cloud-voice work in the CT920 working tree; no such changes or credentials were copied. Historical architecture documents are retained as historical evidence, not current runbooks.
