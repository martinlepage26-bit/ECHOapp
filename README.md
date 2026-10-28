# ECHO — read aloud, read along

A document-to-speech web application with sentence-level navigation, keyboard controls, and optional local speech synthesis. ECHO combines document parsing, browser speech, and a Cloudflare extraction Worker with explicit data-handling boundaries.

## Technical review

| Focus | Evidence |
| --- | --- |
| Architecture and data flow | [Architecture](ARCHITECTURE.md) |
| Automated verification | [CI workflow](.github/workflows/verify.yml) |
| Local speech integration | [Companion](companion/) |
| Reconciliation and measured behavior | [Verification notes](docs/reconciliation/2026-10-17.md) |

**Start here:** [Open the reader](https://martin.govern-ai.ca/echo/) or use the setup below. The optional PHAROS voice requires an existing local service; browser voices provide the standard reader path.


## Setup and operating guide

The [existing detailed README](https://github.com/martinlepage26-bit/ECHOapp/blob/eaade8b6a018fb581ecb94bc24506fed5b9c55a7/README.md) remains available at the revision preceding this presentation update. It contains setup, checks, operating requirements, and limitations.
