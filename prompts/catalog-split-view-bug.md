---
date: 2026-06-20
branch: claude/catalog-split-view-bug-kbgw1q
files_changed:
  - src/main.ts
  - tests/catalog.spec.ts
---

## Human

Sometimes when I click a link to the catalog multiple times really quickly,
the catalog opens up with a kind of split view — two catalogs in two different
internal panes, or three.

## Assistant

Root cause: a re-entrancy race in `showCatalogPage` (`src/main.ts`). The pane
is built lazily behind an `if (!catalogEl)` guard, but `createCatalogPage`
*awaits a manifest `fetch`* before returning, so `catalogEl` stays `null`
across the whole async gap. Any second call that lands during that window — a
rapid second click, or the `popstate` that the first click's `history.pushState`
synchronously fires — sees `catalogEl` still `null`, passes the guard again,
and calls `createCatalogPage` a second time. Each call does
`container.appendChild(page)` with a fresh `<div id="catalog-page">`, so two or
three clicks stack two or three catalog panes. Only the last assignment to
`catalogEl` sticks, but all the DOM nodes are already appended and visible.

Fix: guard the async span with an in-flight promise. Store the pending
`createCatalogPage(...)` promise in `catalogElPromise`; concurrent entries
reuse that one promise (`catalogEl = await catalogElPromise`) instead of
kicking off another build. This is the standard idempotent-lazy-init pattern;
the sibling page constructors (`createWhatsNewPage`, etc.) are synchronous, so
they don't share this race and were left untouched.

Verified with a Playwright repro that fires four rapid pushState+popstate route
syncs (the same concurrency a triple-click produces) and asserts exactly one
`#catalog-page` exists. Confirmed it fails on the pre-fix code (multiple stacked
panes) and passes after — promoted into `tests/catalog.spec.ts` as a permanent
regression test.
