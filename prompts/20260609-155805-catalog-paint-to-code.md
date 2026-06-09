---
session: "1kdce9"
timestamp: "2026-06-09T15:58:05Z"
model: claude-opus-4-8
tools: [subagent, playwright, node]
sequence: 2
---

## Human

After landing the `api.paint.*` primitive, asked whether we could go back
through the catalog and convert past paint operations to code — "do we have
that information?" — then to do the whole catalog, using subagents to
parallelise, with a follow-up PR.

## Assistant

## Key decisions

**We have the data.** Catalog session payloads (`public/catalog/*.partwright.json`)
carry serialized `colorRegions` descriptors per version. A survey showed the
convertible kinds dominate: 257 `byLabel`, plus a handful of plain `slab`; the
Tier-B kinds (`triangles`/`brushStroke`/`coplanar`) and — importantly — all
`cylinder`/some `slab` regions that are `smooth` do NOT convert.

**Why smooth regions stay in the sidecar.** A `smooth` slab/cylinder is a
*refining* region: it subdivides the mesh so the painted edge follows the
analytic boundary. Model-underlay regions (where `api.paint.*` lands) don't
drive subdivision, so converting a smooth region would coarsen its edge —
a fidelity change. The converter only moves "plain" descriptors (no smooth,
centroid coverage, axis-aligned box) so every conversion is pixel-identical.

**Deterministic script over hand-editing.** Built `scripts/convert-catalog-paint.mjs`
rather than having agents edit 112 curated JSON files by hand — a mechanical
JSON→code transform must be deterministic and reviewable. It gates on
language (manifold-js only — SCAD/voxel/replicad skipped), wraps the original
code in an IIFE (`const __pwModel = (() => { … })(); …api.paint.*…; return __pwModel;`)
so any return shape keeps working, copies colours/params verbatim, and re-parses
the output.

**Ordering safety (the subtle correctness point).** Converted regions move from
the user overlay to the model underlay, which always renders *below* the
overlay. To preserve layering the converter only moves the lowest-`order`
PREFIX of convertible regions, stopping at the first region that must stay.
This guarantees no retained (overlay) region can jump above a converted
(underlay) one. Verified independently: across all 50 versions / 237 converted
regions, max(converted order) < min(retained order) everywhere — zero
inversions.

**Verification.** (1) A deterministic full-catalog verifier confirmed colours/
params verbatim, retained regions byte-identical to originals, and no order
inversions. (2) Browser render checks on companion_cube (byLabel), retro_rocket
(8 slabs + retained coplanar window), and toadstool_mushroom (byLabel +
retained brushStrokes) — all render correctly. (3) Five parallel read-only
audit subagents independently re-verified the 50 entries (no browser, to avoid
WASM contention). (4) New e2e spec loads a migrated entry through the real
catalog path and asserts colours come from code, not the sidecar.

**Result:** 50 catalog versions migrated, 237 regions moved into code, 11
non-convertible regions correctly retained in the sidecar (hybrid entries).
Separate PR from the api.paint.* primitive, per the user.
