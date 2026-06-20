---
session: "practical-bohr"
timestamp: "2026-06-19T21:08:00Z"
model: claude-opus-4-8
---

## Human

(1) Clicking a catalog image on the landing page or in the catalog redirects
back to the landing page — maybe the branch just needs to be updated to the
latest main, there were deployment/url/redirect changes. (2) [continuation of
the figure armpit/shoulder fix on this branch.]

## Assistant

## Key decisions

**The redirect bug was branch staleness, not a code bug.** The PR preview was
built from a branch predating main's "editor.html cutover". The stale
`_redirects` rewrote `/editor → /index.html`; Cloudflare canonicalizes
`/index.html → /` (308), so every `/editor?catalog=…` deep-link bounced to the
landing page. It does NOT repro on the vite dev server (which serves the SPA
shell directly) — confirmed with a throwaway Playwright click test — so it was
Cloudflare-clean-URL-specific. Fix: merge latest `origin/main` (brings in the
real `editor.html` static file via the `editorHtmlAlias()` vite plugin). Merge
was clean; my arm/weld edits and main's nose/lips edits touch disjoint regions
of `sdfFigure.ts`.

**Re-baking the figure catalog surfaced a regression in my own weld change.**
The 51 baked figure entries still held the OLD arm geometry, so the catalog
showed the webbed arms regardless of the source fix — re-baking is what lands
the visual change. The first re-bake (at the follow-up's tight `k=0.32`) flagged
`danseur` as `components=2`: its right arm is raised overhead, which welds to the
torso ONLY at the shoulder, so k is the entire arm→torso bridge there and 0.32
was too thin — the overhead arm tore off in the fine browser bake. (Node SSR
`model:preview` still reported 1 — the documented near-threshold
headless-vs-browser componentCount gap; trust the bake here.)

**Picked k=0.48 as the connectivity/de-web sweet spot.** Empirically: hanging
arms re-web above ~0.6, raised arms tear off below ~0.32. 0.48 sits clear of
both — verified the swimmer keeps its open armpit AND the danseur bakes as one
component, then re-baked all 51 with zero flags (no splits, no non-manifold).
267 figure/joint unit tests pass.
