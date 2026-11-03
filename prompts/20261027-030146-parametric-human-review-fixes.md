---
session: "01U8g7w9"
timestamp: "2026-10-27T03:01:46Z"
sequence: 2
---

## Human

(No new request: this addresses the code review run on the api.human spike PR.)

## Assistant

## Key decisions

**Fixed the three reproduced defects.**
- CORS: `/human/*` and `/v1/human/*` added to `public/_headers`, because the
  sandbox's opaque mode fetches from `Origin: null`.
- `api.removePart` on eye labels: `eyes` drops the eyeballs. `iris`/`pupil` fold
  into the surrounding label, since a closed ball can't lose a region without
  opening.
- Voxel weld coming out as more than one piece: the real cause was fingertips
  thinner than the lattice pinching off. They stay attached by a zero-thickness
  edge, so a volume threshold can't catch them. Growing the surface half a
  voxel fixes it. The cleanup now keeps the main body plus anything inside the
  eyeball box, instead of a volume ratio.

**Deduplicated the rasterizer.** `rasterizeOccupancy` gains a `fillRule:
'nonzero'` option (with a unit test), replacing the copy in humanApi.

**Voxel limits stay module constants.** They are API contract bounds (like
meshSdfOps' resolution cap) that callers override per call. They are not
user-tunable app settings, so they don't go in appConfig. The default dropped to
height/300 (~260k triangles) and the cap to 8M samples.

**Preload is best-effort and the regex is narrow.** A failed asset fetch no
longer fails models that merely mention "human"; only an actual `api.human` call
errors.
