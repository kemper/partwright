---
session: "01BsPPSVZ2oFGFXTxRyBtu1M"
timestamp: "2026-10-23T18:44:30Z"
tools: [subagent, git-worktree, vite-node, model-preview]
---

## Human

I do also want to try to create a hair style that is nearly literally the hair from this STL (the Captain Tsubasa Funko), but obviously with some customizable options.

## Assistant

## Key decisions

**Representation: a radial height field plus a coverage mask.** The hair is captured as two 128×64 spherical grids (azimuth × elevation), stored as base64 bytes, about 24 KB of source:
- the distance from a capture centre to the hair's OUTER surface;
- a signed angular distance to the edge of the hair coverage.

Hair is everything inside the radius and inside the mask. The radius is sampled with a clamped Catmull-Rom cubic, so there is no stair-stepping and no ringing beside lock edges. The mask is a distance field, so the hairline, fringe points and hem keep crisp sub-cell outlines instead of following grid cells.

Overhangs fill in, by design. Funko hair is nearly star-shaped from the head centre.

**Landmark frame, not an ellipsoid fit.** The fused STL has no skull under the hair, and a skin-only ellipsoid fit is ill-posed. The frame is instead built from landmarks that exist on both a mesh and a rig head:
- the face front at eye height on the midline;
- the face half-width W at the cheeks;
- the eye-to-chin drop H.

Capture measures them from the segmented skin and eye parts. The build measures them by ray-marching the real head SDF (`on: head`). The hair therefore follows headScale, proportions, faceShape and head pose without any rig-specific constants.

**Skull guard that lifts instead of clamping.** A target head can be taller or deeper than the source's. Where it rises above the captured surface, the hair is raised by a dilated, blurred deficit. A hard clamp left a visible ledge. The lift keeps the locks' layering, and a minimum cover (0.4 × `thickness`) is still enforced.

**Capture cleanup.** Coverage is supersampled 4×4 per cell, and specks or pin-holes under 1.5 cells are removed. Small slivers of skin between overlapping fringe locks had punched pits through the hair. The radius is box-filtered over the cell's hair rays, so oblique lock edges become positioned ramps rather than staircases.

**Knobs bake into the grids at build time.** All knobs are applied once per build; evaluation stays at two cubic lookups. Geometric knobs are an inverse warp of the sphere: `mirror`, `tilt`, `windowScale`, `fringe`, and `length` (the hem). Value knobs act on the grids: `spikiness` (deviation from a blurred copy), `smooth`, and `volume` (thickness above the skull).

The defaults reproduce the capture literally. `volume`, `length`, `fringe`, `thickness` and `on` reuse the existing shared F.hair keys.

**Isolation from parallel hair work.** All logic lives in new files:
- `src/geometry/figureHairCapture.ts`;
- `src/geometry/hairCapture/{field,capture}.ts`;
- `presets/`;
- `scripts/capture-hair.mjs`.

sdfFigure.ts gets only the import, the allow-list, the style enum, the key-ownership lines, one dispatch line and the early return. The node is a box carrying the field through `displace`, which keeps the box's tight bounds. That keeps the module free of any import from `./sdf` (the madge graph stays acyclic).

**CharacterSpec parity.** A unit test pins the CharacterSpec hair enum to the library's, so 'captured' was also added to `HAIR_STYLES`. The creator's style list and the codegen were updated too; codegen passes `on: head`.

**Results.** Silhouette IoU of the captured style against the STL hair, in the landmark frame, on the v6 rig head:

| View | Hair IoU |
|---|---|
| Front | 0.88 |
| Side | 0.98 |
| Back | 0.98 |
| Top | 0.995 |

The Tsubasa figure builds in about 25 s, against about 79 s for 'shag'.

The v6 head had been widened to suit the thin shag cap. With the literal hair it had to be narrowed (headScale 2.05/1.9/2.3). The photo IoU is then 0.868 front and 0.872 back, against 0.887 and 0.885 for the hand-tuned shag. The photo's hair is puffier at the top than the STL's.
