# Retro — figure areola: generic helper vs one-off catalog patch

4-Ls from a session that started as "fix the strongman's nipples" and ended as a generic `F.nipples` engine fix.

## Liked
- Verifying defects with my own renders before acting repeatedly paid off: the broad triage agents over-reported (called normal muscled-back anatomy a #702 defect, called the superhero chest *emblem* an areola rod). Ground-truthing two figures myself collapsed a scary 6-class defect list down to the few real ones.
- The shared-helper discipline in `sdfFigure.ts` (`breastMounds`/`ellipsoidFront`/`nippleLineZ` used by BOTH the anchor and the geometry) made the generic fix clean: `pecApex` slotted in as the muscle analog of `breastMounds`.

## Lacked
- A cheap way to know "which azimuth is the FRONT" per figure. `model:preview --view az,el` and the bake thumbnail use *different* azimuth conventions, and facing varies per figure, so I burned many renders discovering 0=side here, 90=back there. `--views front` exists for preview but the colored *bake* has no equivalent — only `THUMB_AZIMUTH` trial-and-error.
- `model:preview` shades by normal and can't show paint, so a *flush* areola is nearly invisible there — every real seating check needs a colored bake (dev server + xvfb), which is slow. Verifying paint-bearing features is disproportionately expensive.

## Learned
- The areola was sinking because the anchor rode the *base* chest ellipsoid while `muscle>0` welds pec masses *forward* of it. The prior fix (`5c0f27f`) shoved the disc proud with a muscle-scaled `eps` — a hack that trades "buried" for "stuck-on". The right fix is to seat on the *actual* surface (pec apex), like bust already does for mounds.
- Re-baking muscled figures surfaced a *separate* pre-existing breakage: eyebrows/ears pushed `faceDetail` over `MAX_DETAIL_REGIONS=16`, so 3 figures can't build at all from current source (#730). Worth a `faceDetail` consolidation or an audit — stacking face+foot(+hand) detail is fragile against the cap.

## Longed for
- **The user had to redirect my altitude twice** ("fix the helper, not this one catalog figure"). I anchored on the literal artifact (strongman) instead of asking up front "is this a one-figure ask or the generic API?". A cheap early scoping question on *altitude* (one instance vs the helper) would have saved a whole patch-then-revert cycle. When a fix touches a shared helper that one figure forks, default to asking whether the helper itself is the target.
- A colored-bake helper that auto-frames the front and crops to a named body region (`--region chest`) so paint QC isn't manual sharp-extract math every time.
