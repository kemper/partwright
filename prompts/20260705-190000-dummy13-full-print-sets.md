---
session: "inverse-cad"
timestamp: "2026-07-05T19:00:00Z"
model: claude-fable-5
sequence: 55
---

## Human

Printed the Dummy 13 kit and found it has only 1 of each unique part;
for an actual build you need the multiples (2 legs, 2 arms, ...).
Asked to update the catalog entries so each part carries its real
quantity — multiple components per part, in the spirit of the #889
part-list idea.

## Assistant

## Key decisions

**Rebuilt both kit entries as complete print sets**: frame = 33 pieces
(quantities from the original `_2x`/`_4x` part names: 7 singles, 6
parts ×2, 2 bridges ×4, all six hands, adapter stand), armor = 25
pieces (7 singles, 9 paired parts ×2). Replaced the hard-coded
translations with a `PARTS = [{name, make, count}]` table + flow-pack
layout (each part's copies adjacent, every piece dropped to z=0) — the
exact structure `api.part` (#889) will formalize.

**Caught two real print-correctness defects via `--expect-components`
gating before baking:**
1. `simplify(0.03)` on the plate FUSED the fist hands' components
   (3→1) — it would have shipped welded articulation. 0.01 is safe;
   the plate now uses a `safeSimplify` that verifies the component
   count survives and backs off (0.03 → 0.01 → none).
2. The fist/grip "3 components" turned out to be hand + 2 sub-mm
   export-debris specks — present in soozafone's ORIGINAL STLs (8–40
   tris, 0.01–0.5mm) and faithfully reproduced by the loop. A
   `dropDebris` pass (<1mm components) now excludes them from the
   print plates.

**Instrument note**: engine-level `decompose()` over-reported the plate
count (35 vs 33); the authoritative check is the welded-mesh
connectivity census over the render mesh (33/33 and 25/25 exact).
