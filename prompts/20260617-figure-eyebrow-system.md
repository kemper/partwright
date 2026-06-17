---
date: 2026-06-17
branch: claude/dazzling-ritchie-ybscy1
files_changed:
  - src/geometry/sdfFigure.ts
  - examples/figure_expectant_mother.js
  - public/catalog/palettes/expectant_mother.json
  - public/catalog/expectant_mother.partwright.json
  - public/catalog/expectant_mother.thumb.png
  - public/ai/figure.md
  - tests/unit/sdfFigure.test.ts
---

## Human

The expectant-mother figure's eyebrows render as spiky, frayed triangles — a
ragged raised ridge above the eyes. The user wasn't convinced a brow *ridge* is
the right thing at all: they wanted something flush with the forehead, "painted
on" (real geometry, not literally painted), sitting above the eyes — plus
different kinds of eyebrows (thin, bushy, …) as a first-class part of the figure
API. Asked to investigate, fix the current defect, and set us up for good
eyebrow creation.

Decisions via AskUserQuestion: build the full preset-driven system (not just the
one-off fix); prototype the look first and let the user pick. After two
prototype rounds the user chose the **fully-flush** look as the default and a
gentle/neutral arch.

## Assistant

Root cause (confirmed with model:preview crops): `buildBrows` built each brow as
a thin raised capsule tube (`browRad = r.head*0.045`) welded into the skull, and
`faceDetail` had **no brow region** — so the thin strip meshed at the coarse body
grid and aliased into slivers. The open brow line-item of #703.

Redesign — brows are now FLUSH, paintable strips, the same idiom iris/pupil and
the areola already use (a curvature-following patch, self-labelled, hard-unioned
at the top level so the colour survives, NOT a `smoothUnion`'d ridge):

- Rewrote `buildBrows`: an arc of 16 capsule segments smooth-welded into one
  strip, then **sunk into the forehead** so only a flush (or, with `relief`,
  whisper-proud) cap reads. Self-labels `'brows'`. A `BROW_SHAPE` preset table
  (`natural`/`thin`/`bushy`/`arched`/`flat`/`angled`/`rounded`/`straight`),
  mirroring `NOSE_TYPE`/`LIP_SHAPES`. Knobs: `shape`, `width`, `taper`, `relief`,
  plus back-compat `thickness`/`lift` **multipliers** (so the ~50 catalog figures
  that pass `brows: { lift, thickness }` keep working).
- `faceDetail`: added a per-brow refinement sphere (+ `browEdgeLength`,
  `brows:false` to drop) — closes the brow part of #703. ~+10k tris on a figure.
- `assembleFace`: in-assemble brows switched from `smoothUnion` to hard `union`
  (label-safe; the flush strip barely protrudes so the weld is invisible). Still
  flattens to skin in the `.label('skin')` weld — documented that dark brows want
  the top-level `F.face.brows()` path like the eyes.
- Why not re-bake all 50 catalog thumbnails: their brows stay skin-coloured
  either way (the bake just renders the new flush shape), so the thumbnail diff is
  negligible; left as a follow-up to ride with the existing #674 re-bake batch.

Verification: prototyped 3 looks (flush / whisper-relief / bushy) via the
`model-sculpt` subagent rendered in colour, iterated on user feedback (kill the
hump, fuller coverage, higher-res), then user picked flush. Fixed the expectant
mother to top-level painted brows, added a dark `'brows'` palette colour, re-baked
the catalog entry (`--require-labels brows` gate passes, 6237 brow triangles,
manifold, no warnings). Added unit tests (presets, label, relief→proud, width,
back-compat, faceDetail brow spheres) and confirmed `figure:smoke --require-labels
brows`. Tracking: #724; refs #703.
