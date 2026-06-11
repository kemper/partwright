---
session: "e9c4a1"
timestamp: "2026-06-11T02:16:42Z"
model: claude-opus-4-8
tools: [model-preview, playwright]
sequence: 2
---

## Human

After adding `api.enclosure` and `api.knurl`, asked for new catalog entries that
exhibit those features, ideally parameterizable/customizable.

## Assistant

## Key decisions

**Followed the `examples/*.js` → generator → catalog pipeline** (the documented
path in `public/catalog/README.md`): authored two parametric example files using
`api.params` for the Customizer, added them to the `newEntries` list in
`generators/catalog-entries.ts`, and baked real thumbnails by driving a dev
server with Playwright (`npm run generate:catalog`).

- `parametric_enclosure.js` — `api.enclosure.box` with a lip/screw lid toggle,
  size/wall/radius/fit/screw-size knobs, and an `explode` slider that lifts the
  lid so the tile reads as a two-part box.
- `knurled_control_knob.js` — `api.knurl` with a diamond/straight/ribs grip
  selector and a shaft / D-shaft / heat-set-insert mount selector, a revolved
  dome cap, and an optional pointer notch.

**Simplified the knob's insert mount.** The first version added a standalone
`fasteners.insertBoss` into a bored cavity, which left the boss as a *floating
second component* (`componentCount: 2`). Since the knob core is already solid,
the fix was to just subtract a metric-table-sized melt-in bore — one solid.
Verified every grip×mount combination is manifold and single-component via
headless `model:preview` before baking.

**The generator's `maxComponents: 1` assertion is hardcoded.** The two-part box
returns `componentCount: 2` by design, so the bake failed the assertion. Added
an optional `maxComponents` field to `CatalogEntry` and threaded it into the
`runAndSave` call (defaults to 1), then set `maxComponents: 2` on the enclosure
entry — rather than weakening the assertion for every entry.

**Contained the generator's blast radius.** `npm run generate:catalog` runs
*every* generator in `generators/`, which re-baked ~24 unrelated entries (sdf,
gears, some `.scad` examples) with fresh tessellation noise. Reverted all of
that incidental churn with `git restore`, then re-ran only my generator
targeted (`playwright test … generators/catalog-entries.ts`) so the diff is
exactly the two new entries + their manifest lines. `lint:catalog` passes;
both entries embed real thumbnails and sit well under the size budget.
