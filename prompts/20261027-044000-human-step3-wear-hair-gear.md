---
session: "01U8g7w9"
timestamp: "2026-10-27T04:40:00Z"
sequence: 4
---

## Human

Going to bed: do all the remaining steps of the realistic-character plan
(kemper/partwright#1151) overnight. "I especially would love clothing armor and
accessories to work better on these humans." This commit is step 3.

## Assistant

## Key decisions

**Clothing is shells over the skin, not separate garments.** Each item is a
region of the body (or of MakeHuman's skirt helper surface), chosen by a
scalar field: bone-weight groups, a position along the limb, landmark heights.
The region is clipped with marching triangles, offset outward, and given a
side wall, so it fits any body, age and pose and stays printable. Items layer
in list order through a per-vertex "cover" offset. Skirts and coat tails also
write into the cover, so a belt over a coat goes outside it.

**Fixes found by looking at high-res renders, not by reasoning:**
- Ragged hems: the cut follows a field that is linear per triangle. Fixed by
  fairing the hem polyline, tangentially only, so the seam stays on the skin.
- Crumpled plates: offsetting along raw normals folds in concave regions.
  Plates now offset from a smoothed copy of the skin along smoothed normals.
- Nipples poking through plates: a plain Laplacian shrank the convex torso,
  and the clearance clamp then popped the nipples back out. Switched to Taubin
  λ/μ smoothing with the clamp applied inside each pass.
- Nipples under thin cloth: no amount of smoothing helps, because the cloth
  has to stay outside the skin. A top or cuirass now applies MakeHuman's own
  `nipple-size` / `nipple-point` sliders (explicit morphs still win).

**Footwear is a signed-distance field, not a shell.** A shell copies every
toe, so shoes read as painted feet. Each shoe is the posed foot's SDF, closed
morphologically so the toes merge into a toe box, offset by the upper,
extruded along the sole normal, given a heel block, and cut on the shin. The
caller meshes it with `levelSet`. Sabatons moved to the same path.

**Hair and beards are a head-local SDF, placed through the head socket**, so
they follow the head in any pose:
- the scalp is the skin's distance pushed out above a hairline that tapers
  into the skin;
- styles are envelopes on top: a curtain for bob/long, capsule chains for
  tails (relaxed out of the body so they drape), an afro cloud whose underside
  rolls onto the forehead, mohawk blades, spikes;
- beards are a jaw/cheek region with the lips clear, plus a mass under the
  chin for a full beard;
- long hair below the shoulders is restricted to the back, because the
  curtain was running down the torso sides under the arms.

**Accessories come from measured sockets.** These include the hand grip frame,
plus any bone. The necklace now drapes: it samples the outermost skin (and
worn layer) round the neck base, lower at the front. A plain ring was a
floating hoop because the neck radius measurement caught the jaw. That
measurement is fixed too.

**API cleanups:** `flare` was parsed but unused. It now swings skirts and coat
tails out. Wear's unused `style` key is removed.
