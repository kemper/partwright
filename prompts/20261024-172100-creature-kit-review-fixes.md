---
session: "b1b76dd3"
timestamp: "2026-10-24T17:21:00Z"
sequence: 2
tools: [work-reviewer]
---

## Human

(No new request. These follow-ups come from the review subagent's pass over
the api.sdf.creature PR.)

## Assistant

## Key decisions

**`crease` with `[x, z]` points now casts through the surface's bbox centre in
Y.** The `reach` passed to `surfacePoint` spans the whole bbox from the query
point. Previously the line started at y = 0 with the default reach, so a head
or snout far from y = 0 (any forward-snouted creature) "missed the surface".

**`build.ground` defaults to the feet's ground, and to no clip without feet.**
A raised `feet.ground` was never flattened, and a feet-less creature modelled
around the origin silently lost its lower half to the default z = 0 clip.

**The clip stays on the skin only; the doc was corrected instead.**
Intersecting labelled parts would drop their labels (labels don't propagate
through intersect), so the doc now says the skin and unlabelled claws are
clipped and labelled parts are not.

**Smaller fixes:**
- the detail limit now matches the core's 24;
- user `detail` entries are validated under their own index;
- integer counts (`veins` / `toes` / `fingers`) are rejected rather than
  rounded;
- `null` means "default";
- `eyes.aspect` must be positive;
- the ear outline start scales with `length`;
- a mirrored detail sphere centred on x = 0 is no longer duplicated;
- the doc tables now match the code.
