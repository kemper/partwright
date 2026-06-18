---
date: 2026-06-18
branch: claude/charming-planck-5j7ic8
files_changed:
  - src/geometry/sdfFigure.ts
  - tests/unit/sdfFigure.test.ts
  - public/catalog/expectant_mother.partwright.json (re-baked)
  - public/catalog/princess.partwright.json (re-baked)
  - public/catalog/diva.partwright.json (re-baked)
  - public/catalog/witch_casting.partwright.json (re-baked)
  - public/catalog/staff_mage.partwright.json (re-baked)
  - public/catalog/chibi_wizard.partwright.json (re-baked)
---

## Human

[Follow-up to the runway gown fix.] Why do the expectant mother and another
non-runway figure have skin-colored patches on their dress? Was that meant to
be leg holes (for cases like the runway figure putting their legs through)?
[Clarified:] the skin patches are on the lower hips near the knee, on the
OUTER sides of the legs.

## Assistant

Not leg holes — a real coverage bug in `F.clothing.top`'s dress branch.

**Diagnosis.** The dress skirt is a single centered, tapered cone, and the
guaranteed-coverage underlayer is `buildTorso` only — which has **no legs**. The
legs spread outward (the `upperLeg` joints sit at ±x and stance adds more), so at
mid-thigh the outer leg surface out-runs the cone radius and **pokes through its
side as a bare-skin patch** on the outer thigh/knee. It hides from a straight-front
view (the patch faces sideways) which is why my first pass — sampling the belly
front — found nothing; a 3/4 bake showed the skin oval immediately. An SDF probe
marching outward (+x) from each leg between hip and knee confirmed `skin` won the
union surface at z≈18–21 (the leg sat ~0.1–0.2 units proud of the dress).

**Fix.** In the dress branch (`hemZ` below the pelvis), fold the legs into the
coverage masses: `masses = masses.union(buildLegs(rig))` before the `.round(t)`
offset, so the legs — offset by the garment thickness and clipped to the existing
skirt zone + hem — can never be poked through. This mirrors exactly how
`buildPants` guarantees leg coverage. The cone still provides the drape and stays
solid *between* the legs (no culotte split); the leg offset only fills where the
leg out-runs the cone, so the skirt bulges slightly to follow the outer thigh
(realistic). Gated on `isDress`, so a normal waist-length top never wraps the
thighs.

**Verified.** Outer-thigh probe now returns `dress` at every height (leg sits
1.2 units inside). Re-baked all six catalog dress/robe figures — the gowns
(princess/diva/witch) gained a few hundred triangles, the robes that exposed the
most leg (staff_mage +36k, chibi_wizard +35k) gained the most — all render clean
with the skirt draping over the legs and no skin patches. Two regression tests
added: a spread-leg dress must enclose the outer thigh (fails on the reverted
code — verified: skin pokes +0.23), and a non-dress top must still leave the
thighs bare. typecheck + 1482 unit tests green.

This is a second, independent defect from the merged #742 runway hem fix (that
one amputated the chest; this one leaks the legs) — both in the same dress path.
