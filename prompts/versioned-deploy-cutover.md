---
date: 2026-06-15
branch: claude/versioned-deploy-cutover
files_changed:
  - package.json
  - public/_redirects
  - vite.config.ts
  - CLAUDE.md
---

## Human

"I'm just wondering if we can do the cutover sooner with just a v1? I'd like to
get it fully out there and deployed." Clarified the model: people use
`www.partwrightstudio.com/editor` and it just uses the latest (versions hidden),
but `/v1/` also works if typed directly; a `/current/` alias for latest is fine.

## Assistant

Phase 3 **slice 5: the cutover** — wired the deploy so the versionless root is
the latest version (unchanged) and each major is *also* a real pinned mount.
Stacks on #688 (the `DEPLOY_BASE` machinery).

The model the user wanted, mapped to mechanism:
- **`/`, `/editor`, … → latest, versionless** (exactly today's behavior — no
  change, nothing breaks, versions hidden by default).
- **`/v1/…` → a real pinned, frozen build** (not a redirect — so it survives a
  later cutover where the root becomes `v2`; that's what makes versioning
  *mean* something).
- **`/current/… → 302 to the versionless latest`** (stable "newest" alias).

Changes:
- **`build:deploy`** (package.json): `npm run build` (versionless root → `dist/`)
  then a `DEPLOY_BASE=/v1/` build nested into `dist/v1/`. One combined deploy;
  Cloudflare's build command must point here to activate (default `build` stays
  versionless-only, so CI/preview builds aren't slowed).
- **`public/_redirects`**: `/current/* → /:splat` alias, and the per-mount SPA
  fallback `/v1/* /v1/index.html 200` listed BEFORE the root `/* /index.html 200`
  (first-match-wins → `/v1/editor` serves the pinned build, `/editor` the root).
- **`baseAwareManifest` Vite plugin**: rewrites the copied `dist/manifest.json`
  `start_url` + icon `src`s under the base, so a `/vN/` PWA install launches at
  the version (closes the #680 manifest gap). No-op at `/`.
- **CLAUDE.md**: documented the topology, `build:deploy`, the Cloudflare
  build-command step, and the build-from-tag immutability note.

Why this is data-safe: IndexedDB/localStorage are per-origin, so root and `/v1/`
share the same sessions (identical app today); per-major DB segmentation only
matters once `v2` actually diverges (tracked, v2-time).

Verified locally:
- `build:deploy` produces the correct dual tree — `dist/index.html` → `/assets/…`
  (versionless), `dist/v1/index.html` → `/v1/assets/…` (pinned); root manifest
  `start_url:"/"`, `/v1` manifest `start_url:"/v1/"` + `/v1/` icons; `_redirects`
  carries the `/v1/` + `/current/` rules.
- A deterministic check of Cloudflare's documented `_redirects` semantics
  (static-asset-first, then first-match) confirms `/editor`→root build,
  `/v1/editor`→pinned `/v1/` build, `/v1/catalog`→`/v1/catalog.html`,
  `/current/editor`→302 `/editor`.
- Earlier (#688) verified the `/v1/` app fully boots incl. the WASM engine via
  `DEPLOY_BASE=/v1/ npm run dev` (dev server sends COEP/COOP).
- typecheck clean; 1438 unit pass.

Caveat surfaced honestly: `wrangler pages dev`'s local `_redirects` emulation was
unreliable here (cross-served the root build for `/v1/editor` once, then wouldn't
start) — so the nested-SPA precedence must be confirmed on a **real Cloudflare
preview** before flipping production. Cloudflare's documented first-match
semantics (verified above) say it's correct.

Go-live (gated on the user): point the Cloudflare build command at
`npm run build:deploy`, deploy a preview, confirm `/v1/editor` serves the pinned
build, then promote. The production flip is therefore doubly gated (merge + CF
config) and reversible (revert the build command).
