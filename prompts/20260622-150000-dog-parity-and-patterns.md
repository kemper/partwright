---
session: "sharpbell"
timestamp: "2026-06-22T15:00:00Z"
sequence: 6
---

## Human

bring the dog up to the cats quality level and also do the patterned colorways
for both

## Assistant

## Key decisions

Two deliverables in one branch.

**1. Dog → cat parity.** Rewrote `evals/cases/chibi-dog/model.js` from a single
hand-tuned spaniel into a **parametric `buildDog`** mirroring the merged chibi
cat: same paramsSchema shape (pose sitting/standing, build
puppy/slim/average/chonky, ears floppy/perky/long, tail curl/short/fluffy, face
snouty/round) plus the cat's face machinery — figure-API **eyelids** (kills the
bug-eye protrusion), ball-in-ball iris/pupil caps, a colored **muzzle** pad, a
dark button **nose** at the snout tip, a **mouth** smile, and **innerEar** pads.
Dog-specific anatomy vs the cat: a *projecting* snout ellipsoid (long in −Y) so
it reads canine not flat-faced, and floppy ears as a two-segment capsule chain
drooping down the head sides (perky = upright triangles, long = basset). Added a
default golden palette + solid colorways (black/cream/chocolate) for parity with
the cat's grey/black/white. The visual polish loop (hollow-eye fix, ear droop,
snout projection) was delegated to the `model-sculpt` subagent so the render
images stayed out of the main context; I finished the eyes by hand (iris disc
0.62→0.80·eyeR + pupil 0.36→0.44 so the amber fills the eye instead of a
startled ring of white).

**2. Patterned colorways for both — proud-blob marking mechanism.** Added a
`pattern` select to both models (cat: solid/tuxedo/points; dog:
solid/tuxedo/tan-points). The mechanism: markings are **proud labeled blobs
blended into the body** (the existing muzzle recipe), NOT `body.intersect(region)`.
I tested the intersect approach first — a coincident patch *ties* with the
`body` label in the nearest-centroid color remap and salt-and-peppers the
boundary (verified in a render). A blob that sits slightly proud wins the
nearest-centroid assignment cleanly, so the color is flush and solid. `solid`
emits zero markings, so the default render (and the existing cat eval baseline)
is byte-unchanged. Pattern colors live in per-pattern palette JSONs
(`palettes/tuxedo.json`, `palettes/points.json` / `tan-points.json`).

**Scope call — clean patterns only.** Tuxedo (bib + socks) and points/tan-points
(siamese mask+ears+paws / Doberman muzzle+chest+paws) are clean with proud blobs.
**Tabby stripes / calico were deferred**: stripes done as proud blobs would emboss
as raised welts; doing them flush needs true per-triangle surface paint, not the
blob trick. Filed as a follow-up rather than shipping a lower-quality version.

All variants verified via `model:preview` (manifold, 1 component, genus ≤ 2, all
of eye/iris/pupil/nose nonzero) across both poses and every pattern. No app/src
code touched — these are standalone eval-corpus models, so `model:preview` colored
renders are the verification surface (no browser spec needed).
