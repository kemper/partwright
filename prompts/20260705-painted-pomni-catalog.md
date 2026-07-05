---
date: 2026-07-05
branch: claude/confident-carson-gpo63q
files_changed:
  - public/catalog/pomni_articulated.partwright.json
  - public/catalog/pomni_articulated.thumb.png
  - public/catalog/manifest.json
  - src/ui/catalog.ts
  - src/content/data/catalogCategories.ts
---

## Human

Create a new catalog entry with a fully painted Pomni so the owner can
observe the generative-paint pipeline working on the whole model, not
just the head.

## Assistant

Ran the multi-view projection loop on the entire 25-piece plate (seed
top view describing every piece's character colors, four el-35 obliques
with the guard + retry protocol — one back view rejected all three
attempts, correctly — then the deterministic fill: 212k triangles,
zero unreachable). Two follow-up passes fixed what the plate-scale run
got wrong: the proven head-only projection series was REPLAYED onto the
plate session from the images already on disk (scope-relative views
make them portable; zero new Gemini calls), and the 39 connector-clip
islands were painted solid black by island index — a first blanket
"blacken all small islands" pass wrongly caught the torso/pelvis puff
balls, so the final classifier uses audited island centers (outer
columns / bottom rows only).

Packaging exposed a real product constraint: catalog entries embed
their mesh, and this one is 23 MB — but `/catalog`'s in-app page
prefetches EVERY entry payload just to read its embedded thumbnail.
Shipping the entry that way would add 23 MB to every catalog visit. So
the manifest gained an optional `thumbnail` sidecar field: entries that
declare one skip the payload prefetch entirely and fetch on click
(disabled tile + dimmed state while the download runs). The static
prerendered /catalog page was already lazy (tiles are links into
`/editor?catalog=`), so the fix targets the in-app overlay, and the
payload was trimmed to a single version (each version embeds its own
12.4 MB mesh copy; version history of an AI-painted import is not worth
12 MB a step).

Verified end-to-end in the browser: /catalog renders the tile with zero
payload bytes fetched, click imports the 516k-triangle painted session.
Honest quality note recorded for the owner: the head (replayed at
island scale) is round-6 quality; body pieces carry plate-scale seed
speckle — the per-piece-scoped loop is the known fix and stays on #885.
