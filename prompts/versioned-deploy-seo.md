---
date: 2026-06-14
branch: claude/versioned-deploy-seo
files_changed:
  - src/seo/meta.ts
  - src/seo/sitemap.ts
  - src/ui/help.ts
  - src/ui/whatsNew.ts
  - src/ui/legal.ts
  - vite.config.ts
  - tests/unit/sitemap.test.ts
---

## Human

Continue Phase 3 (versioned deployments). User picked "PR3: SEO/content
base-aware" from the options after PR2 (#660, runtime routing) merged.

## Assistant

Phase 3 **slice 3: SEO/content base-awareness** — but re-scoped after
discovering the build-time/runtime split, so it stays a clean no-op at base `/`.

**Key discovery that drove the scope:** the static content pages
(catalog/help/legal/whats-new/ideas HTML) are PRE-RENDERED in a Vite plugin
(`prerenderPlugin.ts` → `render.ts`/`chrome.ts`/`shell.ts`) running in the
**Node build context**, where `import.meta.env.BASE_URL` is NOT defined — so
`appPath` (which reads it) can't make those hrefs base-aware. And `chrome.ts` is
**dual-context** (also imported by the runtime `ideasPage.ts`). Threading the
base into that whole build chain (`config.base` → prerender → render → shell →
chrome) plus the six static `.html` files, `_redirects`, the `absoluteUrls`
plugin, and the actual `base` flip is intricate and only *exercisable once the
base actually changes*. So I folded all of that into **PR4 (the mount)** where it
can be built and verified together, and kept PR3 to the surface that is cleanly
base-aware and verifiable at `/` today:

- **`src/seo/meta.ts`** (runtime, browser): canonical / og:url / og:image /
  twitter:image now resolve through `appPath`/`assetPath` before `absolutize`,
  so a `/vN/` build emits canonical URLs under its own mount. No-op at `/`.
- **In-app content-page hrefs** (`help.ts`, `whatsNew.ts`, `legal.ts`): the
  self-contained inline `<a href>`s (`/whats-new`, `/help`, `/ai.md`) routed
  through `appPath`/`assetPath`. These run at runtime so the helpers resolve
  correctly; they don't go through the dual-context `chrome.ts`.
- **`src/seo/sitemap.ts`**: `buildSitemapXml` gained a 3rd `base` param
  (appended, so the existing positional `routes` callers/test don't break).
  Kept dependency-free (vite.config imports it in Node) by inlining the
  base-prefix join instead of importing `src/deployment`. Wired
  `dynamicSitemap` to pass Vite's resolved `config.base`. Byte-identical at
  base `/`/`''`.

Explicitly deferred to PR4 (the base flip): the build-time prerender nav
(`render.ts`/`chrome.ts`/`shell.ts`/`prerenderPlugin.ts` + `ideasPage` chrome),
the six static `.html` canonical/og/asset refs, `public/_redirects`/`_headers`,
and the `absoluteUrls` base — all activate with the base and verify together.

Verified: typecheck clean; `lint:deps` acyclic; full unit tier 1403 pass (incl.
2 new sitemap cases: `/v2/` mounting + base-`/`/`''` no-op equality);
`npm run build` clean; and the content/SEO e2e — content-pages (incl. help-page
metadata + canonical/og assertions), legal, smoke — all pass (30/30),
confirming the change is a strict no-op at base `/`.
