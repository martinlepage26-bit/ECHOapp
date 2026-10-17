# ECHO — read aloud, read along

ECHO reads pasted text, local documents and public web pages with browser voices or the existing PHAROS Agent voice on this Mac. It highlights and seeks by sentence, with optional English/French pronunciation of amounts, dates and serial numbers.

- Live reader: https://martin.govern-ai.ca/echo/
- Source: https://github.com/martinlepage26-bit/ECHOapp
- [Base44 / governed reader comparison](docs/reconciliation/2026-10-17.md)
- [Architecture and data flow](ARCHITECTURE.md)

## Run and check

Use Node 22 (`.nvmrc`) and the committed lockfile.

```sh
npm ci
npm run dev        # Vite UI at /echo/; URL extraction needs the Worker
npm run check      # ESLint + Node and Python companion tests
npm run build      # production assets in dist/
npx wrangler dev   # after build: UI plus the URL-extraction Worker
```

`npm run deploy` builds and deploys the `echo` Worker to the two configured `/echo` routes. It requires an authorized Cloudflare session. GitHub CI only validates; it does not deploy. This reconciliation does not change either live website.

## Reader features

- All available browser voices, searchable and grouped by language; document language suggests a voice until one is manually chosen.
- Play/pause/stop, speed, previous/next sentence, click or Enter to seek, and optional follow scrolling.
- English and French number pronunciation. Other languages pass through unchanged.
- Local TXT/Markdown, CSV, JSON, log, RTF, HTML, XML, DOCX, EPUB and PDF import, limited to 25 MB. Scanned PDFs need OCR elsewhere.
- Public-page extraction through `/echo/api/extract` with redirect, literal-address and response-size checks.
- Up to 50 drafts in this browser. Drafts are not synchronized with Base44 or other devices.

Space plays/pauses, Escape stops, and arrow keys navigate sentences when focus is outside an interactive control or dialog.

## PHAROS voice on this Mac

PHAROS already runs the pinned Echo XTTS-v2 voice at `127.0.0.1:8765`.
ECHO's small companion reuses that resident service. It does not load another
model, change the voice, or upload the voice reference.

```sh
npm run build
npm run voice:local
# Open http://127.0.0.1:8787/echo/
```

In the voice menu, choose **Connect PHAROS on this Mac**, then Play. This voice
is English only; other languages retain their browser voices. Playback starts
with a phrase of at most 64 characters, then prepares at most two upcoming clips
during playback. Subsequent clips are at most 80 characters, preferring punctuation
and word boundaries. When measured synthesis time predicts a gap, the first
phrase waits for up to two seconds of preparation ahead; cached replay skips
that lead. Uncached speech still needs local synthesis time; the
transport shows when it is preparing audio. Cached clips play without waiting
for unrelated synthesis. Pause,
resume, stop, speed and sentence navigation work with actual generated audio.
Stopping discards unfinished results and skips disconnected queued requests;
already-started model inference may
finish in the background. No fallback voice is substituted after an error.

For a durable macOS installation after building, run `python3 companion/install.py`.
It installs a loopback-only user LaunchAgent and a Desktop **ECHO — PHAROS Voice**
launcher. It preserves the previous release. To stop the companion without
removing files: `launchctl bootout gui/$(id -u)/ca.govern.echo-reader`.
PHAROS's existing voice service remains the single model owner.

On the verified Mac installation, `python3 companion/install_engine.py` enables
the measured GPU execution profile on that same PHAROS LaunchAgent. It preserves
the original server, model checkpoint, reference, generation settings and Python
environment. A separate pinned PyTorch/torchaudio 2.8.0 environment reads the other
dependencies from the original environment. FP32 inference uses one CPU thread,
materializes constant weight normalization once, and decodes bounded GPU windows
with context on both sides. No quantization or alternate voice is installed.
The service warms its speech kernels before reporting ready.

The installer checks the exact reviewed server and voice-reference digests,
retains the original LaunchAgent, and restores its previous configuration if
startup fails. Run `python3 companion/install_engine.py --restore` to restore
the original execution path. Both commands preserve the original model files.
See the [engine timing receipt](docs/reconciliation/pharos-engine-2026-10-17.json)
for measured scope and limits. The final uncached browser run started in 5.95
seconds, with gaps of 0.59 and 0.24 seconds; cached replay started in 0.03 seconds.
Heavy concurrent memory/GPU use can still delay uncached speech.

The hosted reader can use the same connection once this branch is deployed.
It only contacts the companion after the reader selects Connect. Chrome may
ask for local/loopback network access; allow it only for your ECHO page. The
local reader works at the companion's own origin without that cross-origin
permission. Browser restrictions are not disabled. See [Chrome's local network
access guidance](https://developer.chrome.com/blog/local-network-access).

## Data handling

Local document parsing and saved drafts stay in the browser. Browser voices labelled **on device** report `localService=true`; other browser voices may use their provider's online service. URL import sends the requested URL to this app's Worker, which fetches the remote page. Do not assume that every browser voice is offline.

The Base44 cloud voices and cloud drafts remain available on the original Base44 app. They are not silently mapped to browser voices or migrated here. No Base44 SDK, API key or D1 database is needed. PHAROS mode sends short text clips only to the companion on this Mac. Audio is cached in bounded process memory (32 MiB) and clears when the companion restarts; browser audio buffers are released during playback. Temporary render files are validated and removed. No voice recording or generated speech is committed to GitHub. The existing XTTS installation and its licensing remain unchanged.

## Source reconciliation

The previous GitHub tree (`0250700`) described an older UI/Worker/clone stack. The stable CT920 reader commit `7d5be63e191620a0f10d8538354642c0325844b6` reproduced all six files served by the governed site byte-for-byte on 2026-10-17. Its source is now the root application. Two keyboard/mobile fixes and a mobile Drafts close button were applied during verification; see the comparison for exact scope.

The older stack remains recoverable from Git history. `docs/history/`, `docs/inventory/` and `docs/architecture/redesign.md` describe earlier implementations. The site repository's old `/echo` artifact is a historical fallback; the live route is served by this separate Worker.
