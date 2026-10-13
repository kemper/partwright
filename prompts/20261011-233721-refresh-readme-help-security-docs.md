---
session: "1oppb9"
timestamp: "2026-10-11T23:37:21Z"
---

## Human

Asked for a concise but thorough feature list for a Reddit post, then asked
whether the README, help pages, and changelog needed updating to capture recent
features, and approved a docs PR to fix the gaps.

## Assistant

## Key decisions

**Changelog left alone.** The What's New entry for 1.6 matches package.json.
Everything merged since (Discord link, catalog model fixes) belongs in the next
release's entry, which the /release skill writes at release time.

**README rewritten where stale, kept where accurate.** "What it does" now
covers the four engines, bring-your-own AI (five provider types), painting and
textures, all import/export formats, and the workflow features. The old
8-example table became a pointer to the ~160-entry catalog, the architecture
tree reflects the current src/ layout, and AI setup now leads with the built-in
assistant before external agents. The API reference pointer moved from
CLAUDE.md to public/ai.md. Shortcuts, deployment, and license were left as is.

**Help page: four gaps filled.** Convert model to code, voice input, VOX and
video export, and VOX/SVG/image import were reachable in the UI but missing
from /help. Each claim was checked against the UI source (button labels,
command-palette titles, MediaRecorder MIME fallbacks).

**SECURITY.md corrected, CSP untouched.** It claimed 7 runtime dependencies,
"no network libraries", a CSP that blocks outbound fetch, ~3,000 lines of
source, and zero outbound requests. In fact connect-src deliberately allows
https: (for custom AI endpoints and Import from URL), and the SDK and WebLLM
ship lazily. The doc now describes what is actually true. Tightening the CSP
would break those features, so that is out of scope for a docs change.
