---
date: 2026-07-07
task: "Backup & sync — local folder + Google Drive (PR #908)"
model: claude-opus-4-8
---

## Liked
- The `onStateChange` chokepoint + `exportSession` reuse meant the whole sync
  layer sat cleanly above existing plumbing with zero session-schema churn — a
  new IndexedDB store was the only persistence change.
- Two parallel scout agents (storage-architecture + web-API feasibility) up
  front gave me every file:line and the COOP gotcha before writing a line.

## Lacked
- Nothing blocking. The advanced-settings modal's `cloneConfig` enumerates
  sections by hand, so adding a config section is a two-spot edit that a static
  check won't catch if you miss the clone — easy silent drop.

## Learned
- The app HARD-REQUIRES cross-origin isolation (no single-threaded WASM
  fallback), so a COOP header flip for an OAuth popup is a whole-app risk, not a
  feature-local one. The right call was a redirect OAuth flow that needs no
  header/CSP change — `connect-src https:` already covers the Drive REST calls.
- `drive.file` is non-sensitive → no Google verification, no scary consent
  warning, and still makes a user-visible folder (unlike hidden `drive.appdata`).

## Longed for
- A single capability registry the toolbar + `window.partwright` + help() derive
  from. I had to touch four places for parity (interface, dropdown DOM, API
  method, help table). The CLAUDE.md note already calls this out as unbuilt.
- `send_later` is unavailable in web/remote sessions (permission stream closes),
  so there's no self-wake to confirm CI-success — only failures arrive via
  webhook. A working self-check-in would close the "is it green?" loop.
