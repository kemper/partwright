---
date: 2026-06-17
branch: claude/kind-cerf-dikkfm
files_changed:
  - src/geometry/sdfFigure.ts
  - public/ai/figure.md
  - public/catalog/boxer_guard.partwright.json (re-baked)
  - public/catalog/danseur.partwright.json (re-baked)
  - public/catalog/sprinter_start.partwright.json (re-baked)
  - examples/figure_strongman.js (reverted to main)
  - public/catalog/flexing_strongman.partwright.json (reverted to main)
---

## Human

Wait. I thought the whole point of our fix was to generically fix the nipple
helper / API function? ... I don't care about this one catalog figure. I want
all future figures to be made better.

## Assistant

Re-scoped from patching the one hand-rolled strongman areola to fixing the
generic `F.nipples` engine helper, so every future muscled figure benefits.
Reverted the strongman-specific commits (it uses a custom hand-rolled pec puff
the engine can't see; it would need converting to the `muscle` axis to benefit,
which the user doesn't want here).

**Generic root cause (confirmed by rendering the leaned sprinter):** the areola
anchor `rig.torso.nippleL/R` is projected onto the *base* chest ellipsoid, but
when `muscle > 0` `buildTorso` welds pectoral masses that bulge FORWARD of that
base chest. So on every muscled figure the anchor sat *behind* the real pec
surface — the areola sank in (only a partial rim poked through), which the
`5c0f27f` "muscle-scaled `eps` push" had hacked around (trading buried for
stuck-on).

**Fix — make the areola ride the pec, the way it already rides the bust mound:**
- New `pecApex(j, r, muscle, spine)` helper, the muscle analog of
  `breastMounds`. It reproduces `buildTorso`'s `pec(sx)` ellipsoid EXACTLY (built
  rest-frame then spine-leaned) and returns the per-side front apex (projected at
  the same head-unit nipple line) plus the pec's vertical radius. World-frame, so
  a leaning figure carries its nipples with the chest. Geometry mirrors the
  shared-helper discipline (`breastMounds`/`ellipsoidFront`/`nippleLineZ`) so
  anchor and welded geometry can't drift.
- `buildRig`: nipple anchor now prefers mound apex (bust) → pec apex (muscle) →
  bare-chest front.
- `buildNipples`: `surfR` = pec vertical radius when muscled (matched curvature so
  the flush coin's rim doesn't sink — the same insight the strongman exposed),
  and the muscle-scaled `eps` push is removed (the anchor is on the real surface
  now, so a small uniform proudness suffices).
- `muscle: 0` and `bust > 0` figures take byte-identical code paths.

Verified on the leaned sprinter (areola resolves to >0 triangles, seats flush on
the pec at upper-chest height; the buried partial-arc is gone). Re-baked the 3
muscled bare-chest catalog figures that build cleanly (boxer, danseur, sprinter).
Updated `public/ai/figure.md`.

**Discovered + filed separately:** 3 other muscled figures (lotus_yogi, surfer,
tai_chi_master) can't re-bake — the recently-merged eyebrow/ear features pushed
their `faceDetail` region count over the `MAX_DETAIL_REGIONS = 16` cap
(`build.detail: at most 16 detail regions`). Reproduces on clean `main` (nipple
change stashed), so it's pre-existing and unrelated → GitHub #730. Their stale
catalog entries are left as-is; the engine fix still reaches them at source level
once #730 is resolved.
