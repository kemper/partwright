---
session: "8e3748ca"
timestamp: "2026-06-12T13:00:00Z"
model: claude-opus-4-8
---

## Human

"I've noticed my app isn't showing up on Google AI overviews. if searched by
name it comes up in the listings. is there more I could be doing to get it
picked up by the crawlers?"

After an audit (robots.txt welcomes all AI crawlers, sitemap + per-route meta
present, content pages already prerendered, landing-page JSON-LD present), the
user chose two of the gaps to implement: **prerender `/ideas`** and **add
JSON-LD to subpages**.

## Assistant

## Why these two

The site was already crawl-friendly — the blocker wasn't a robots/crawl block
but content left on the table. Two concrete, in-our-control gaps:

1. `/ideas` was the only content route with **no** prerendered HTML — it fell
   through the SPA fallback to a spinner, so crawlers saw zero idea text despite
   sitemap priority 0.8.
2. Only the landing page carried JSON-LD; `/help` and `/catalog` had rich
   content but no structured data for AI extraction.

## Key decisions

**Mirror the `/catalog` dual model, don't replace the SPA page.** `/catalog`
already ships *both* a static prerendered page (hard-nav/crawlers) and an in-app
overlay (soft-nav). I followed that exactly for `/ideas`: added `ideas.html` +
an `ideasBody()` renderer in `src/content/build/render.ts` (registered in
`CONTENT_PAGES` and the Vite Rollup inputs), and kept the existing
`createIdeasPage` overlay for in-app soft-nav. Lower risk than ripping out the
overlay, and consistent with the established pattern.

**Preserve interactivity via a deep-link.** A static page can't hand an
in-memory tile click to the editor, so every static tile is an
`<a href="/editor?idea=<id>">`. Added `loadIdeaIntoEditor(id)` in `main.ts`
(invoked from `syncEditorFromURL`, parallel to the existing `?catalog=` path):
prompt ideas prefill the AI panel; interactive ideas open a photo picker and run
the same voxel/relief flow the in-app tile would. Extracted `openReliefForIdea`
to avoid duplicating the luminance-mode relief logic. Removed the now-dead
`/ideas` boot-spinner special-case (hard-nav no longer boots the SPA there).

**JSON-LD via the existing build pipeline.** `prerenderContentPages`
(`order: 'pre'`) injects the body before `absoluteUrls` runs, so relative
`"url"` fields in injected JSON-LD get absolutized at build for free. Added a
`jsonLdScript()` helper (escapes `<` so a model name can't break out of the
script) and emitted: `CollectionPage` + `ItemList` for `/ideas` and `/catalog`
(122 models), `TechArticle` for `/help`. Verified the `/editor?idea=` and
`/editor?catalog=` ListItem URLs come out absolute in the production build.

**Bug the e2e caught (and the fix).** The targeted spec flagged that
`loadIdeaIntoEditor` runs inside `syncEditorFromURL` during boot — *before*
`initAiPanel` builds the drawer — so `prefillAiInput` hit `if (!inputEl) return`
and silently no-opped. Fixed in `aiPanel.ts` by queuing the text in
`pendingPrefill` when the input doesn't exist yet and flushing it at the end of
`initAiPanel` once the drawer is built. The SPA soft-nav path is unaffected (it
runs post-boot). Rewrote `tests/ideas.spec.ts` to drive the static page (link
tiles, no `#ideas-page`/spinner) instead of the old SPA overlay; all 5 pass.

## Verification

typecheck clean · 1273 unit tests pass · production build emits
`dist/ideas.html` with crawlable content + absolutized JSON-LD · sitemap still
lists `/ideas` · 5/5 ideas e2e green · screenshot of the static page posted.
