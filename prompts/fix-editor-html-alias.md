---
date: 2026-06-19
branch: claude/fix-editor-html-alias
files_changed:
  - vite.config.ts
  - public/_redirects
---

## Human

After #774: branch deploy /v1/editor 302-redirects to /v1/ (not the editor), and
/current/editor redirects all the way to / — meaning /editor itself redirects to
/ too.

## Assistant

Root cause: Cloudflare Pages canonicalizes `.html`/`/index.html` URLs
(`/index.html → /`, `/foo.html → /foo`) with a 308 — and it applies this to the
DESTINATION of a `_redirects` 200-rewrite. So #774's `/editor /index.html 200`
and `/v1/editor /v1/index.html 200` rules rewrote to `…/index.html`, which
Cloudflare then 308-redirected to `/` and `/v1/`. (And the earlier `/v1/* …`
splat was rejected outright as an infinite loop for the same canonicalization
reason.) Net: every form of `_redirects` SPA-fallback-to-index.html either loops
or redirects the user off the route. `/current/editor → /editor → /` confirmed
the root editor was hit too.

Fix: stop using `_redirects` for the editor and serve it as a **real static
file**, the one mechanism that demonstrably works on this project — the content
pages (`/catalog → catalog.html`). Added an `editorHtmlAlias()` Vite plugin that
copies the SPA shell `index.html` → `editor.html` in each build's outDir (so
`dist/editor.html` and `dist/v1/editor.html`), and removed the two canonicalizing
`_redirects` rules. Cloudflare now serves `/editor → /editor.html` and
`/v1/editor → /v1/editor.html` at their clean URLs — no rewrite, no
canonicalization, no loop. `/` and `/v1/` still serve their index via
directory-index; `/current/editor → /editor` (302) then lands on `/editor.html`.

Verified: `npm run build` emits `dist/editor.html` (refs `/assets/…`) and
`dist/v1/editor.html` (refs `/v1/assets/…`), each byte-identical to its
sibling `index.html`. `_redirects` now carries only the alias/redirect rules +
the harmless `/*` backstop. (Note: this was a main/staging-preview regression;
production is unaffected until the next promotion.)

Per-major note: the plugin runs for every build outDir, so a future `/v2/`
automatically gets `dist/v2/editor.html` — no per-major `_redirects` line needed.
