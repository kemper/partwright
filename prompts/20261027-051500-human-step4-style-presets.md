---
session: "01U8g7w9"
timestamp: "2026-10-27T05:15:00Z"
sequence: 5
---

## Human

Overnight: do all the remaining steps of kemper/partwright#1151. The user
originally said they were jealous of sites that make "really cool anime,
funko, etc characters" from a mesh AI, and wanted the same driven by code.
This commit is step 4, style presets.

## Assistant

## Key decisions

**A style reshapes the rest pose, before anything else is built.** Each
styled bone gets an affine transform: uniform for the head and eyeballs,
length/girth along each limb, a vertical squash for the trunk, uniform for
hands and feet. The transforms compose down the skeleton and every vertex
(helpers included, so the joints follow) blends them by skin weight. The
skeleton, pose, expressions, clothing shells, footwear, hair and accessory
sockets therefore all fit the styled body with no special cases.

**Presets layer MakeHuman sliders under the user's morphs**, for example
bigger eye openings, smaller nose and mouth, and a rounder or squarer head.
Any knob can be overridden: `style: { preset: 'chibi', head: 2.3 }`.

**Toy faces needed more than scaling.** A realistic face scaled 2.6× reads as
creepy, not as a toy. Three additions fixed that:
- Taubin smoothing over the head drops the small anatomy.
- `simplify` pulls the head's outward-facing skin toward a fitted
  superellipsoid. Inward-facing skin, such as the inside of the mouth, is
  skipped so it can't be pushed through the face.
- Sculpted eyes replace the eyeballs. Each eye is a layered ellipsoid bead
  (white, iris, pupil, highlight, lash line), or one black bead for a toy.
  The bead is sized from the eye spacing and seated just proud of the
  furthest-forward skin in the eye's outline. The first two attempts sized
  it from the eyeball, whose joint sits at the back of the eye, and from the
  eyeball front. Both left it buried under the brow and cheeks.

**Triangle budget.** Big heads and feet made the hair and footwear lattices
mesh far finer than needed (a Funko hit 507k triangles). The hair voxel now
scales with head size, and footwear is sized per foot length. Footwear
thickness is at least ~1.3 voxels, plus a measured thickening, so toes thinner
than the lattice still end up inside the shoe. The probe showed chibi toes
poking out before this.
