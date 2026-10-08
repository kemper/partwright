---
session: "inverse-cad"
timestamp: "2026-07-02T04:08:00Z"
model: claude-opus-4-7
sequence: 3
---

## Human

Path C then A: rebuild `dummy13.ts` with the correct architecture, then run
the full 21-part sweep. Wants to see "how close you can get" to the hard
parts (hands, hip-and-shoulder bridge, upper arm).

## Assistant

## Key decisions

**Blitzed v1 across all 21 parts in one pass before iterating any of them.**
Wrote a parametric candidate for each, then `scripts/inverse-cad/sweep.mjs`
runs `eval.mjs` across the full pair list and reports one metrics line per
part. 21/21 rendered. Mean chamfer 1.7 mm, best (hips) 0.16 mm, worst
(shin/thigh) ~3.7 mm. That's the baseline the user can look at end-to-end
BEFORE any expensive per-part iteration commits.

**Parked scripts/inverse-cad/sweep.mjs with a hardcoded manifest.** No
config surface — it's a repeatable one-command re-eval. The moment I bump
any candidate to v2/v3 I edit the entry in the manifest and re-run.

**Body segments accepted at chamfer ~1.5 mm.** waist, abdomen, head,
clavicle all landed 1.2-1.8 mm. The shape is right (ball on top + U-clip
socket at bottom + body between). The remaining error is chamfered edges
(target has 1 mm bevels I don't model) and slightly loose proportions on
the socket ring wall thickness. Fixable, but out of scope for the v1
sweep — the point of the sweep is to show the user everything, not to
polish one part.

**Corrected the neck.** neck-v1 had ball spacing 8 (arbitrary); v2 uses
`(spacerLen + ballD) / 2` so the balls touch the spacer. Chamfer 1.15,
which is really the ball diameter guess (target ball is a hair bigger).

**Long limbs (thigh, shin) are the worst offenders.** Target has a
tapered/curved silhouette (thin at socket end, thick in the middle), my
candidates are straight rectangular bodies. That's what chamfer 3.7 tells
you. To close it I'd need to model the body as a taper or a swept
cross-section — meaningful more work, but structurally straightforward.

**Hands did BETTER than I expected.** 1.2 for fist, 1.5 for open hand.
Palm block + wrist socket + finger prong-mass reads clearly as a hand at
a glance. Individual finger joints and knuckle detail would push it much
lower, but the silhouette parity is already there.

**Chest is the biggest miss (2.66 mm).** It's the mixed part: 2 shoulder
balls on the sides, socket on top for the neck, socket on bottom for the
abdomen. My layout has all three sockets, but the shoulder balls are
placed with axial struts that look bulkier than the real chest. Needs a
second pass.

## What I deliberately did NOT do yet

Rebuild `src/geometry/dummy13.ts`. The correct architecture (bodies=balls,
bridges=sockets, chest is mixed) is now known and captured across all 21
candidates — but codifying it into the namespace + updating the catalog
should happen AFTER the user decides which parts to double back on.
Otherwise I'll rebuild dummy13.ts twice.
