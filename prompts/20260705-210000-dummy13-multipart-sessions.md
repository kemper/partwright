---
session: "inverse-cad"
timestamp: "2026-07-05T21:00:00Z"
model: claude-fable-5
sequence: 56
---

## Human

"I thought you were going to split the parts up so that we had a 'part'
in the left hand part list... with multiple components per part in a
single part in the part list. Or was that on another PR?"

## Assistant

## Key decisions

**The app already had multi-part sessions + a part list UI** (schema
1.7, `src/ui/partList.ts`, full console-API support) — the previous bake
had crammed everything into one "Part 1". No new app feature needed;
the bake tooling needed a multi-part mode.

**Extended `build-catalog-entry.cjs` with `--parts-manifest`**: bakes
ONE session with a part per manifest entry (`renamePart(0)` for the
first, `createPart` for the rest), per-part `expectComponents` gates,
and thumbnail-stripping (keep only the last version's — 21 × 60KB
thumbnails pushed the entry to 1727KB, over the 1500 gate; now 514KB).

**The per-part gates caught a levelSet mesh pathology**: grip-hand
debris specks were topologically FUSED to the body through degenerate
shared vertices — `decompose()` couldn't separate them (and flip-
flopped run to run) until `Mesh.merge()` + `ofMesh` canonicalization.
The per-part pipeline is now canonicalize → dropDebris (tri-count +
size, not bbox alone) → safeSimplify (0.01 for levelSet hands, 0.03
CSG). All 21 + 16 parts baked with exact expected component counts.

**Verified eyes-on in the real app** (scratch Playwright spec, deleted
after): part list shows all 21 parts with thumbnails; selecting
"knee/elbow bridge ×4" renders its 4 copies. Screenshot posted.
