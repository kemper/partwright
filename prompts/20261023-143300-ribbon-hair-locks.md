---
session: "01BsPPSVZ2oFGFXTxRyBtu1M"
timestamp: "2026-10-23T14:33:00Z"
model: claude-opus-5-5
issue: kemper/partwright#1055
tools: [subagent, git-worktree, model:preview photoMatch, vitest probes]
---

## Human

Make `F.hair(rig, { style: 'anime' })` look like real anime / Funko vinyl hair:
chunky, flat, ribbon-shaped locks that sweep and come to sharp points, instead
of thin round tubes that read as tendrils or dreadlocks. Build a ribbon-lock
primitive (flattened lens section 3–5× wider than thick, wide axis tangent to
the skull, swept along a curve, width tapering to a point, optional twist,
smooth-welded base), use it in 'anime' with fewer, bigger locks (fringe,
sideburns curving forward, crown flicks, layered back) and slightly longer
hair, add `lockShape` / `chunk` and tuft `shape/width/thickness/twist`, keep
other hair styles byte-identical, add unit tests and docs, and validate on the
Tsubasa chibi (v5) by photo-match score with only a few image reads.

## Assistant

**Primitive: a chain of flattened ellipsoids, not a new swept SDF node.** A
true swept-lens primitive would need a new `sdf.ts` leaf (public API, opaque to
the SDF→JS compiler, so slower per eval). Ellipsoids oriented on the bezier
tangent (`eulerFromBasis(T, W, N)`, W = outward × T so the wide axis lies on
the skull) stay in the compiler's fast path. Each ellipsoid spans ~2.6 segment
lengths so neighbours overlap heavily, and a thickness-sized smooth union fills
the scallops. Width follows `(1 − s^2.2)^0.75` (holds breadth, then points);
thickness tapers only ~55%. Samples are shifted toward the tip so the last
ellipsoid is already narrow, giving a sharp point. "Outward" comes from the
uncut cap's SDF gradient in 'anime' and the head-centre ray in `F.hair.tuft`.

**Layout tuned by score, not by eye.** Ten scoring passes against the
front/back photo bands. The first ribbon pass scored *worse* than v4 (0.805)
because flat side locks seen from the front are edge-on, so they read as thin
strings and the head looked narrow. The width profile showed where the photo
is wider (temples and eye level), so the fixes were: a temple-flare lock per
side, an over-the-ear lock flaring at eye level rather than below it, side
locks twisted 50–65° so their faces show from the front, a wider crown mass,
and crown locks that run back over the top. Crown locks were re-parametrised
to go front-top → over the pole → back. The ellipsoid (θ, φ) with φ > π/2
flips to the opposite azimuth, so the first version crossed the top
diagonally. Final: 0.876 front / 0.881 back (v4 0.868/0.879, v3 0.879/0.872).

**Sliver check by probe, not by image.** The 1200px close-up showed a sawtooth
at the temple hairline. A vitest probe counted skin points where the hair
hovers within 1.3 units, which is a meshing sliver. With the higher window top
and the fringe floating off the skin, the count was 33, against 13 for v4. The
fix was to revert the window top to v4's height and press the fringe and
sideburn bodies onto the skin, which brought the count to 23. Most of what
remains is the shared window-lip of `animeCap`, which v4 has as well.

**Kept stable:** the mop and every non-anime style are untouched. Seven
figure examples have byte-identical `model:preview --json` stats before and
after. 'anime' and `F.hair.tuft` had not shipped, so their defaults changed
freely: 'anime' now uses 14 locks with ribbon shape, and tuft defaults to
`shape: 'ribbon'`. `lockShape: 'tube'` keeps the same layout with round locks.

**Cost:** the v5 build takes about 34 s, against about 24 s for v4. There are
more primitives per lock: 9 ellipsoids instead of 4 capsules.
