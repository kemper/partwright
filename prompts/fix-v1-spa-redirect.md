---
date: 2026-06-19
branch: claude/fix-v1-spa-redirect
files_changed:
  - public/_redirects
---

## Human

Production: https://main.partwright.pages.dev/v1/editor returns 404 (while /v1/
shows the landing and the v1/ asset dir is uploaded). Cloudflare deploy log:
`#19 /v1/* /v1/index.html 200 — Infinite loop detected in this rule and has been
ignored` (and the same for `#32 /* /index.html 200`).

## Assistant

Root cause (from the deploy log, not timing): Cloudflare **rejects splat SPA
fallbacks whose destination canonicalizes back into the splat source** — it
strips `/index.html → /` and `.html`, so `/v1/* → /v1/index.html` becomes
`/v1/* → /v1/` which re-matches `/v1/*` → "infinite loop" → the rule is dropped.
With the rule gone, `/v1/editor` (no backing file) falls through and 404s. The
build itself was correct (dist/v1/ deployed; `/v1/` works via directory-index).

Fix: replace the splat with **exact per-route** SPA fallbacks, whose source can't
canonicalize back into itself, so Cloudflare accepts them:
- `/editor /index.html 200`
- `/v1/editor /v1/index.html 200`

The editor is the app's only no-file route (`/`, `/v1/` serve their index via
directory-index; `/catalog`, `/help`, `/v1/catalog`, … are real pre-rendered
.html; the editor's `?session=…` states share the `/editor` path). Also made the
**root** `/editor` explicit (the original `/* /index.html 200` was loop-rejected
too, so root SPA had been surviving only on Cloudflare's built-in fallback).
Kept `/* /index.html 200` as a documented, harmless backstop (the vite dev/preview
server still honors it). Verified both new rules are loop-safe (dest canonicalizes
to `/` and `/v1/`, neither equal to its source).

Per-major caveat: each new pinned major needs its own `/vN/editor /vN/index.html
200` line, and any new top-level SPA route needs a line — documented in
`_redirects`.
