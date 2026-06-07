---
date: 2026-06-07
branch: claude/catalog-thumbnail-sync-JO47s
files_changed:
  - public/catalog/spur_gear_pair.partwright.json
  - public/catalog/modular_drawer_bin.partwright.json
  - public/catalog/sdf_mixed_mechanical.partwright.json
  - scripts/catalog-audit.cjs
  - scripts/catalog-fix-thumbnails.cjs
  - public/catalog/README.md
  - package.json
---

## Human

I'm not convinced all the catalog thumbnails have been updated as changes to the
catalog have happened. Can you investigate? (Then, after the investigation: do a
full in-browser audit of every entry and fix the stale ones.)

## Assistant

Catalog thumbnails are base64 PNGs baked *inside* each
`public/catalog/*.partwright.json` payload, rendered in the same pass that
produces the entry's `geometryData` stats. Nothing re-bakes them when the model
code changes (the only catalog CI gate, `lint:catalog`, checks file size), so
drift is structurally possible — the user's hunch was right.

**Why the obvious signal is a trap.** Each payload carries a `codeHash`
(`simpleHash(code)` from `statsComputation.ts`) next to the thumbnail. 35/89
entries had code that no longer hashed to their stored `codeHash` — but
spot-rendering four of them (`chess_rook`, `wind_turbine`, `clock_face`,
`dna_helix`) showed *visually identical* geometry: the edits were cosmetic
(comments/renames). Worse, the one genuinely-stale manifold-js entry
(`sdf-mixed-mechanical`) **passed** the hash check. So `codeHash` both over- and
under-reports; only re-rendering is reliable.

**The reliable test.** Re-run each entry's stored code and compare the freshly
computed geometry against the baked stats. Volume + component count are
tessellation-stable; triangle count is not (it swings 100–300% purely from mesh
resolution differences and must be ignored). This is angle-independent, so it
sidesteps not knowing each thumbnail's stored hero-camera angle.

I did this in two passes:
1. Headless `model:preview` over the 58 manifold-js entries — flagged
   `sdf-mixed-mechanical` (32.7% volume jump: a cube knob redesigned into a ball
   knob). But `model:preview` only runs manifold-js, leaving 10 scad + 13
   replicad + 8 voxel unverifiable.
2. **Full in-browser audit** (`scripts/catalog-audit.cjs`, new) — drives the dev
   server with Playwright, imports + re-runs every entry through the real app
   engine (all four engines), diffs fresh vs baked stats. All 92 entries ran
   with zero errors. Three genuinely stale, all visually confirmed:
   - `spur-gear-pair` (scad): two free gears → gears embedded in a base plate.
   - `modular-drawer-bin` (scad): closed solid box → open divided bin (−80% vol).
   - `sdf-mixed-mechanical` (manifold-js): cube knob → ball/palm grip.

   The two scad ones were in the headless blind spot — the in-browser pass earned
   its keep.

**Fix.** `scripts/catalog-fix-thumbnails.cjs` (new) re-imports each flagged
entry, re-runs its code, and refreshes both the thumbnail *and* the
geometry-derived stat fields (volume, vertex/triangle counts, surfaceArea, genus,
crossSections, codeHash) while preserving entry-identity fields
(sessionUrl/galleryUrl/sessionId) and the rehydrated color regions. Verified the
4 paint regions on `sdf-mixed-mechanical` survive. `sdf-mixed-mechanical` had two
versions with identical code; mirrored the fix onto v0 with a Node one-liner
(an initial Python rewrite escaped em-dashes as `\uXXXX` — reverted and redid in
JS to match the repo's UTF-8 `JSON.stringify(…,2)+"\n"` formatting exactly). The
diff is surgical: only thumbnail + stat values change.

Wired `npm run audit:catalog` into package.json and documented the
audit→fix loop in `public/catalog/README.md` so the next change to a catalog
model has a guard to catch the stale-thumbnail case.
