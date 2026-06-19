---
date: 2026-06-19
branch: claude/fix-editor-html-alias
files_changed:
  - public/_redirects
---

## Human

Follow-up on PR #775 (serve the editor as a real editor.html instead of a
`_redirects` index.html rewrite). The CI/Cloudflare deploy is green; clean up
before merge.

## Assistant

Spotted a stale comment in `public/_redirects`: the block above the `/*`
catch-all still claimed "the explicit `/editor` / `/v1/editor` rules above are
what actually serve the SPA" — but #775 *removed* those rules. The SPA editor
route is now served by the real `editor.html` files the `editorHtmlAlias()`
plugin emits at the root and in each pinned mount (`/editor` → `editor.html`,
`/v1/editor` → `/v1/editor.html`), exactly like the content pages.

Rewrote the comment to describe the real-static-file mechanism and dropped the
dangling reference to the deleted rules. Comment-only change — no routing
behavior changes.
