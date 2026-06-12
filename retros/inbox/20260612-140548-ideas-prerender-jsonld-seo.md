---
date: "2026-06-12T14:05:48Z"
task: "feat: prerender /ideas as static HTML + add subpage JSON-LD for crawlers"
pr: 630
areas: [build, import-export, ai-panel, docs]
cost: medium
---

## Liked / Worked
- The `/catalog` dual-model (static prerendered page for hard-nav/crawlers +
  in-app SPA overlay for soft-nav) was a perfect template to copy for `/ideas`.
  Recognizing that `showCatalogPage` and `catalog.html` coexist turned what
  looked like a risky main.ts routing refactor into a low-risk additive change.
- The prerender pipeline ordering (`prerenderContentPages` is `order:'pre'`, so
  it injects the body before `absoluteUrls` runs) meant JSON-LD `"url"` fields
  got absolutized at build for free — no extra wiring. Worth knowing before you
  design a new injected-content feature.
- Delegating the targeted e2e run to `test-triage` caught a real bug
  (`prefillAiInput` no-opped because the deep-link runs during boot, before
  `initAiPanel` builds the drawer) with a precise file:line root cause. That
  diagnosis is what made the fix obvious (queue + flush).

## Lacked
- No quick way to assert "this route ships crawlable HTML" — I hand-grepped
  `dist/ideas.html` for titles + JSON-LD + absolutized URLs after a full build.
  A tiny check would have been faster and is regressible.
- `model:preview`-style fast feedback exists for geometry but not for the
  content/SEO surface; verifying the prerender meant a ~27s production build.

## Learned
- The set of prerendered content pages is duplicated across **five** places that
  must stay in sync when adding one: `CONTENT_PAGES` (render.ts), the Rollup
  `input` map (vite.config.ts), and three header comments (prerenderPlugin.ts,
  shell.ts, public/_redirects). Only the first two are load-bearing; the comments
  drifted (said "four") and the work-reviewer caught it. A single source of truth
  for the page list would remove the comment-drift class entirely.
- `prefillAiInput` (aiPanel.ts) silently returns when `inputEl` is null. Any code
  that calls it during boot (a new `/editor?...` deep-link) must account for the
  panel not existing yet — now handled via a `pendingPrefill` queue flushed at
  the end of `initAiPanel`, but the ordering trap isn't documented near either.

## Longed for
- `npm run check:prerender` (or a unit test): build the content pages and assert
  each declared route emits non-empty `<main>` text + a canonical + its JSON-LD,
  with absolute URLs when SITE_URL is set. Would have replaced my manual
  `grep dist/*.html` pass and guards against a future route silently regressing
  to an empty SPA shell (which is exactly the `/ideas` gap this PR fixed).
- A derived single list of content pages so `CONTENT_PAGES`, the Rollup inputs,
  and the doc comments can't drift apart.
