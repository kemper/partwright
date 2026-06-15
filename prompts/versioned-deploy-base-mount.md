---
date: 2026-06-15
branch: claude/versioned-deploy-base-mount
files_changed:
  - vite.config.ts
  - src/content/rebasePaths.ts
  - tests/unit/rebasePaths.test.ts
  - src/entry.ts
  - public/route-init.js
  - src/ui/help.ts
  - src/ui/ideasPage.ts
---

## Human

Continue the versioned-deployment work — "move onto the next task" after PR3
(#679, SEO/content) merged. The next slice is the actual base mount (PR4).

## Assistant

Phase 3 **slice 4: make the deployment base a configurable knob and prove the
app works mounted at `/v1/`** — without flipping production. `base` now comes
from `DEPLOY_BASE` (default `/`), so the eventual cutover is a one-line env
change; everything here is a strict no-op at `/`.

Methodology: rather than reason about Vite's base behavior, I built with
`DEPLOY_BASE=/v1/` and **inspected the dist output** to find exactly what Vite
bases automatically vs. what it leaves root-relative, then patched only the gaps:

- **Vite already bases** every asset/script/css/font/favicon/manifest URL, the
  `<link rel=canonical>` href, and asset-like meta (`og:image`).
- **Gaps it leaves** (fixed here): content-page `<a>` nav hrefs, route-like meta
  (`og:url`), inline JSON-LD `url`, and the pre-paint scripts.

Changes:
- **`base` from `DEPLOY_BASE`** (normalized leading+trailing slash; default `/`).
- **`src/content/rebasePaths.ts`** (new, dependency-free, unit-tested):
  `rebaseHtmlPaths(html, base)` rewrites root-relative **anchor** hrefs only —
  deliberately scoped to `<a>` so it never double-bases the assets/canonical Vite
  already prefixed. `basePrefix(base)` collapses `/` → `''` (no-op marker).
- **`basePaths()` Vite plugin** (`transformIndexHtml` order `post`): applies
  `rebaseHtmlPaths` to every emitted page → content nav hrefs get the base.
- **`absoluteUrls` base guard**: an idempotent `withBase()` that prepends the
  base only if not already present, so `og:url`/JSON-LD `url` (Vite left them
  root-relative) get based while `canonical`/`og:image` (Vite already based)
  don't double.
- **Pre-paint pair**: `entry.ts` `isLandingRoute()` now compares `appRoute(...)`;
  `public/route-init.js` (static, can't read `import.meta`) derives the base
  from its own `<script src>` (which Vite bases) via `document.currentScript`.
- **Runtime in-app pages**: `help.ts` section bodies (shared content data with
  `/ideas`,`/ai.md` links — the deferred #680 item) and `ideasPage.ts` header
  chrome are rebased with `BASE` at runtime (`innerHTML`), covering the
  dual-context content that the build plugin can't reach.

Deliberately deferred (tracked in #680): `public/_redirects` (Cloudflare
deploy-topology-specific — depends on how the versioned projects are structured),
the root **launcher** page, and the actual production base flip. Those are the
real cutover and belong together when a `v2` is concrete.

Verified:
- typecheck clean; `lint:deps` acyclic; full unit 1438 pass (incl. new
  `rebasePaths` cases — anchor-only scoping, no-op at `/`, no double-base).
- **`DEPLOY_BASE=/v1/` build inspected**: content nav, `og:url`, canonical,
  `og:image`, route-init src all correctly under `/v1/`; `grep` for `/v1/v1/`
  across all HTML + sitemap → **none** (no double-base).
- **Browser boot under `/v1/`** (`vite preview`): `/v1/` shows the landing,
  `/v1/editor` hides the landing and mounts `#app` at pathname `/v1/editor` —
  i.e. the `route-init.js` currentScript base-derivation + `entry.ts` routing
  work at runtime.
- No-op at base `/` confirmed by the content/SEO + smoke + landing e2e (34/34).

Follow-up after a work-reviewer pass (0 blocking):
- **route-init.js** — hardened the base derivation with a
  `querySelector('script[src$="route-init.js"]')` fallback for the rare null
  `document.currentScript`, so a `/vN/` deploy can't misderive `base='/'` and
  flash the spinner on the landing page.
- **vite.config** — documented that `absoluteUrls`'s `withBase` guard relies on
  Vite's asset/canonical basing running before the transform (the
  double-base-free invariant the `/v1/` build verifies).
- Renamed the rebasePaths "double-base" test to state the apply-exactly-once
  contract and assert the double-on-second-pass behavior explicitly.
- **`public/manifest.json`** (`start_url`/icon srcs root-absolute) flagged as a
  `/vN/` PWA-install gap — a static file Vite doesn't process; tracked in #680
  for the cutover (same bucket as `_redirects`).
