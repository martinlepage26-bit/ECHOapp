# ECHO architecture

The active application is a Vite/React reader in `src/` and a Cloudflare Worker in `worker/index.js`. Vite builds static assets under the `/echo/` base. The Worker strips the mount before passing asset requests to its `ASSETS` binding.

## Ownership

| Path | Responsibility |
| --- | --- |
| `src/pages/Home.jsx` | Intake, shortcuts, dialogs and controls |
| `src/hooks/useSpeech.js` | Browser speech, cancellation, pause/resume and sentence progress |
| `src/lib/sentences.js` | Source-preserving sentence segmentation and bounded utterances |
| `src/lib/verbalize.js`, `numbers.js`, `dictionaries.js` | English/French pronunciation without changing visible source text |
| `src/lib/language.js` | Heuristic language suggestion |
| `src/lib/importFile.js`, `zip.js` | In-browser document extraction |
| `src/lib/drafts.js` | Browser-local draft storage |
| `worker/index.js` | Static assets and public URL extraction |
| `test/` | Segmentation, pronunciation and Worker route tests |

There is no application account, cloud speech endpoint or draft database in this build. Browser-provided online voices may still send text to their providers. Local file parsing does not upload files. URL import calls the same-origin Worker; it is a network operation.

## Playback

The hook speaks one sentence at a time, including number substitutions when enabled. Source offsets and visible text remain intact. Sentence progress is estimated; it is not word-boundary alignment. Generation IDs invalidate canceled runs. Long unpunctuated passages split at soft boundaries around 400 characters. The UI retains the governed reader's sentence navigation instead of Base44's separate utterance per word.

## Deployment

`wrangler.toml` targets Worker `echo` on `martin.govern-ai.ca/echo` and `martin.govern-ai.ca/echo/*`. The website repository does not build this source. Do not run its old sibling-directory ECHO sync command to publish this app. An authorized deployment uses `npm run deploy` here; CI runs checks and build only.

The URL extractor rejects common private/loopback/metadata literals and checks redirects. These checks are not proof of DNS-rebinding protection or a complete security audit. Cloudflare networking behavior and authenticated/private-page imports are outside this reconciliation's verification scope.

## Provenance

See `docs/reconciliation/2026-10-17.md` and the six-file hash receipt. The imported stable source is separate from unfinished cloud-voice work in the CT920 working tree; no such changes or credentials were copied. Historical architecture documents are retained as historical evidence, not current runbooks.
