# ECHO — consolidated state and handoff (2026-08-07)

This supersedes piecing the story together from 14 separate handoff files. It answers two
questions directly: **why has this gotten this complicated**, and **what, right now, actually
works vs. doesn't** — verified fresh this session by 8 independent agents hitting the live
production endpoints and reading the live source, not by trusting any earlier "done" claim in
this repo (including this session's own earlier claims — two of them turned out to be wrong;
see "What earlier verification missed" below).

## TL;DR

- **Dictation (STT) is completely down in production**, on every path, right now. Not a new
  break — the same `4006: daily free neuron allocation exhausted` error first seen 2026-08-01,
  still unfixed for this one feature.
- **TTS "works" (returns 200 + real audio) but voice selection is fake right now.** Every one of
  the 9 voice ids — including the ones that are supposed to use real Cloudflare Workers AI —
  is being silently rendered by the SpeechT5 clone fallback. Workers AI itself is not serving
  a single request today. Different voice picks (`athena`, `system`) come back sounding
  identical.
- **If you loaded `martin.govern-ai.ca/echo/` any time before this afternoon's deploys, your
  browser is very likely still running old JS**, invisibly, for up to 4 hours per load, because
  the hardline site's cache-buster is a hand-typed string dated 2026-08-01 that nothing updates
  on rebuild. This is the single most likely explanation for "it still isn't working" when
  every server-side check says 200 — **hard-refresh the tab before judging anything else.**
- Library (drafts/transcripts), file import (.txt/.md/.docx/.pdf incl. PDF), the new systemd
  clone-origin, CORS, and deploy/build integrity are all genuinely fine — verified with real
  round-trip tests, not assumed.

## Why this got complicated (the honest version)

In under a month, ECHO has been through:

- **4 sequential full backend/stack generations**: Astro on the old `cerebrhoe` host (dead) →
  a Python/Mongo backend from the "Emergent" scaffolding platform that **could not even boot**
  (`emergentintegrations` isn't a real PyPI package — every session before 2026-07-11 that
  reported success had been testing against a mock, never the real backend) → a decoupled
  FastAPI/Piper backend on an ephemeral tunnel → the current Cloudflare Worker + Workers AI + D1
  stack (since 2026-08-01).
- **1 parallel, independently-built duplicate implementation** that grew for weeks inside an
  unrelated repo (`martinlepage26-bit.github.io`) before anyone noticed and merged it
  (2026-08-06).
- **A free-tier, 10,000-neuron/day Cloudflare Workers AI quota placed in the critical path of a
  public product**, which hit its ceiling on literally the first production deploy
  (2026-08-01) and has now caused **3 separate incidents** from the same root cause — first
  seen and left unresolved 08-01; "repaired" for TTS only this morning by building a fallback
  around it (not fixing it); confirmed still live and broken for dictation this afternoon,
  in this session.
- **3 dedicated sessions** to stabilize the clone-voice fallback origin itself, which ran
  unsupervised on a process-killable, reboot-losing ephemeral tunnel for about 4 weeks before
  finally getting systemd + a named tunnel today.
- **A 19-day gap** (2026-07-13 → 2026-08-01) with no handoff doc at all, during which the
  entire backend was swapped from Python to Cloudflare Workers — no record of how or why.
- **9 distinct fix/refactor/repair sessions** in this 4-week window.
- Verification has been narrow the whole way through — mocked APIs, 2-of-9 voice spot checks,
  browser smoke tests that never resolved known WebKit/Firefox failures, and **zero logged
  human listen-through in 4 weeks.** Nothing in the historical record shows anyone actually
  opening the app and using it end to end.

None of this is about today's work being sloppy — the systemd/tunnel hardening done this
session is solid and verified. It's that the product has been rebuilt on borrowed, free-tier
infrastructure repeatedly, root causes got bypassed rather than fixed, and every "repair"
verified narrowly enough to miss what broke next.

## What earlier verification missed, this session specifically

Being direct about this, since it's exactly the pattern above repeating: my first pass today
tested 2 of 9 voices via curl and called TTS "verified live." It was working, but that check
could not have caught (and didn't catch) that Workers AI itself was already down and the clone
was carrying 100% of traffic, or that dictation was broken, or that voice selection doesn't do
anything. All three were only found by this session's exhaustive parallel re-check.

## Current state, by subsystem (verified live, 2026-08-07 afternoon)

| Subsystem | Status | Evidence |
|---|---|---|
| TTS — returns audio | Working (all 9 voices, both entry paths) | 18/18 calls HTTP 200, real RIFF/WAVE audio confirmed with `file` |
| TTS — real Workers AI (Aura) | **Not working right now** | 0/9 voices used Workers AI; every response `backend: "clone"`. Confirmed via direct Worker JSON field + response headers |
| TTS — voice selection | **Broken** | `athena` and `system` both render as the literal "echo" clone voice; different picks are not audibly different right now |
| STT / dictation | **Broken, HTTP 503** | Identical `4006` neuron-exhaustion error on all 4 request-shape combinations tested, both surfaces; `stt.js` has no fallback path (confirmed by reading source) |
| Library (drafts/transcripts, D1) | Working | Full create→list→delete→list cycle round-tripped correctly; auth (401 on bad key) correct. Worker-only — hardline site has no Library API at all |
| File import (.txt/.md/.docx/.pdf) | Working | All 4 formats, real files, correct extracted text; PDF-via-unpdf (2026-08-02) survived today's refactor intact |
| Hardline site cache-busting | **Broken** | `?v=20260801-bracefix2` is a hand-typed literal, never updated by the build; `max-age=14400` (4h) with no revalidation means browsers can silently run stale JS after any rebuild |
| CORS (both surfaces) | Working | Correct `Access-Control-Allow-Origin` on preflight and real requests |
| Deploy/build integrity | Working | SHA-256 identical across canonical build, site-repo copy, and live URL — no stale-server-code explanation for anything above |
| Clone-origin systemd units | Working | Both `active (running)` continuously since 14:06/14:07 UTC, zero crashes/restarts in journal |
| ECHOapp repo git state | Clean | Pushed, matches origin/main |
| `martinlepage26-bit.github.io` repo git state | Dirty (ECHO-scoped) | `functions/api/echo-tts.js`, `public/echo/echo-reader.app.js(.map)`, several `src/scripts/echo-*.js`, deleted `src/pages/echo/index.astro` all uncommitted — deploys fine (`--commit-dirty=true`) but git history doesn't reflect what's live |
| Worker `/health` and self-reported status | Misleading, minor | `GET /health` 404s (wrong route); `GET /api/` claims `"backend":"Cloudflare Workers AI"` even though nothing is actually using it right now |

## If you want this actually fixed, in priority order

1. **Hard-refresh `martin.govern-ai.ca/echo/`** (Cmd/Ctrl+Shift+R) before judging anything —
   there's a real chance this alone resolves what you're seeing.
2. **Dictation is down for everyone, right now, full stop** — either give STT the same clone
   fallback TTS got, or accept it's down until the Workers AI quota issue is actually resolved
   (see #4).
3. **Fix or remove the fake voice selector** — right now it's actively misleading (picking a
   voice does nothing).
4. **Actually resolve the Workers AI quota** instead of permanently routing around it — the
   05-01 doc named "upgrade to Workers Paid" as the direct fix and it's never been done in 4
   weeks. Until it is, "TTS works" means "the clone works," full stop, and dictation stays
   broken since it has no equivalent fallback.
5. Fix the cache-buster to be content-hash-derived at build time (mirrors what the Expo/Worker
   surface already does correctly) so this class of "looks broken, isn't" never recurs.
6. Commit the dirty ECHO-scoped files in `martinlepage26-bit.github.io` so git history matches
   what's actually deployed.

None of the above has been done in this pass — this document is the handoff, not the fix. Say
which of these (if any) you want done now.

## Architecture as of today (for reference)

```
Browser (martin.govern-ai.ca/echo)          Expo UI (echo-ai.workers.dev)
  → Pages Function /api/echo-tts              → Worker /api/tts/generate | /api/echo-tts
      1. sample voice → SpeechT5 clone             1. Workers AI (currently failing every call)
      2. Worker echo-ai (Workers AI...)             2. same clone secret fallback
      3. rescue → clone

SpeechT5 clone origin: systemd --user (echo-clone-backend.service on :8099,
echo-clone-tunnel.service = named Cloudflare Tunnel) → https://echo-clone-api.pharos-ai.ca
Survives reboot (loginctl enable-linger). Stable, verified, not the current bottleneck.
```

## Full chronological timeline (4 weeks, condensed)

| Date | Event | Root cause / outcome |
|---|---|---|
| pre-2026-07-09 | Original Astro implementation on `cerebrhoe` host | Retired, host decommissioned |
| 2026-07-09 | Browser assessment + bugfixes | Found & fixed: fake FormData uploads, autoplay-blocked playback |
| 2026-07-11 | First deploy attempt | Backend dead on arrival — `emergentintegrations` package doesn't exist on PyPI |
| 2026-07-11 | Provider decouple (root-cause session) | Real fix: removed Emergent dependency, built provider abstraction, first real speech via **ephemeral** tunnel (flagged fragile same day) |
| 2026-07-11 | Natural readback | Native `<audio>` playback, markdown normalization |
| 2026-07-11 | Cross-browser smoke (mocked API) | WebKit crash, Firefox media error — never resolved |
| 2026-07-13 | Readback alignment | Playwright suite added; human listen-through still not done |
| **2026-07-13 → 2026-08-01** | **undocumented 19-day gap** | Entire backend swapped Python → Cloudflare Worker with zero audit trail |
| 2026-08-01 | Workers AI wiring | First live smoke test: **502, neurons exhausted** — first occurrence, left unresolved |
| 2026-08-06 | Merge webapp | Discovered a second, independently-built Echo living in the site repo for weeks; merged |
| 2026-08-07 AM | Durable-speech repair | Named the 08-01 failure as recurring; made clone a mandatory TTS fallback; **STT explicitly left unprotected** |
| 2026-08-07 | Modular refactor (×2 passes, same day) | Structural cleanup, no behavior change intended |
| 2026-08-07 PM | Clone-tunnel hardening | Ephemeral tunnel → named tunnel + systemd + linger |
| 2026-08-07 PM (this session) | Full diagnostic sweep | Found: STT still down (3rd occurrence), TTS voice selection fake, Workers AI not actually serving any request, browser cache-buster bug |

**Failure-class counts:** Workers-AI-quota incidents: 3. Clone/tunnel fragility repair sessions: 3.
Full stack generations: 4 (+1 parallel duplicate). Distinct fix/refactor sessions in 4 weeks: 9.
