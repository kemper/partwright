---
session: "wauien"
timestamp: "2026-06-13T13:35:00Z"
model: claude-opus-4-8
tools: [work-reviewer, build-catalog-entry]
sequence: 3
---

## Human

(Automated PR review pass on #641.) The work-reviewer flagged the cornrows
catalog entry as a 2-piece bake (should be one component) and over the triangle
budget, plus a nit that the skin-ramp test only checked the endpoints.

## Assistant

## Key decisions

**Root-caused the cornrows fragmentation rather than re-baking blindly.** The
parting-channel *carve* between cords was the culprit: shallow grooves between
close cords pinched the cap shell into thousands of tiny handles (genus 4624 on
the runner), worst on a small head where cords pack tight — and the high genus is
what tipped the bake into multiple components at the marching-cubes threshold.

**Fix in two parts:**
1. *Dropped the groove-carving entirely* — the cords now stand proud on the cap
   and the VALLEYS between them read as the partings. This alone took genus from
   thousands to ~10 (and actually looks better).
2. *Projected each cord onto the cap ellipsoid surface* (`onCap` via the inverse
   ellipsoid radius) so every cord is half-embedded in all directions. The first
   attempt placed cords at a fixed average radius, which let them float off the
   narrower lateral sides — headless bridged them (1 component) but the browser
   mesher didn't (4 components). Surface-projection makes them always overlap the
   cap, so the browser bake lands genus 1, **componentCount 1**, 171k tris (under
   budget). The lesson: verify catalog component counts in the *browser* bake,
   not just `model:preview`.

Only `cornrows_runner` uses the cornrows style, so it was the sole re-bake.

**Nit:** strengthened the skin-ramp test to assert strict monotonic luminance
across the whole ramp (catches a mis-ordered future palette edit), not just the
two endpoints.
