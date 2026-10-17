# ECHO — read aloud, read along

ECHO reads pasted text, local documents and public web pages with the voices available in the browser. It highlights and seeks by sentence, with optional English/French pronunciation of amounts, dates and serial numbers.

- Live reader: https://martin.govern-ai.ca/echo/
- Source: https://github.com/martinlepage26-bit/ECHOapp
- [Base44 / governed reader comparison](docs/reconciliation/2026-10-17.md)
- [Architecture and data flow](ARCHITECTURE.md)

## Run and check

Use Node 22 (`.nvmrc`) and the committed lockfile.

```sh
npm ci
npm run dev        # Vite UI at /echo/; URL extraction needs the Worker
npm run check      # ESLint + Node tests
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

## Data handling

Local document parsing and saved drafts stay in the browser. Voices labelled **on device** report `localService=true`; other browser voices may use their provider's online service. URL import sends the requested URL to this app's Worker, which fetches the remote page. Do not assume that every browser voice is offline.

The Base44 cloud voices and cloud drafts remain available on the original Base44 app. They are not silently mapped to browser voices or migrated here. No Base44 SDK, API key, D1 database, voice reference recording or clone sidecar is needed for this reader.

## Source reconciliation

The previous GitHub tree (`0250700`) described an older UI/Worker/clone stack. The stable CT920 reader commit `7d5be63e191620a0f10d8538354642c0325844b6` reproduced all six files served by the governed site byte-for-byte on 2026-10-17. Its source is now the root application. Two keyboard/mobile fixes and a mobile Drafts close button were applied during verification; see the comparison for exact scope.

The older stack remains recoverable from Git history. `docs/history/`, `docs/inventory/` and `docs/architecture/redesign.md` describe earlier implementations. The site repository's old `/echo` artifact is a historical fallback; the live route is served by this separate Worker.
