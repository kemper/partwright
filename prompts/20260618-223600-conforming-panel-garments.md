---
session: "mfhutf"
timestamp: "2026-06-18T22:36:00Z"
model: claude-opus-4-8
---

## Human

The "Chef Presenting a Dish" has a draping apron that passes through its body.
We need better physics around this situation. While I do want to fix this one
model I also want to fix all future cases of errors like this. Investigate and
report back. (Follow-up: scope = helper + model fix, general front/back-panel
garment family; then "show me several preview images.")

## Assistant

## Key decisions

**Root cause**: the chef's apron was a hand-rolled flat `roundedBox` placed at a
single constant Y in front of the torso. A flat constant-depth slab cannot follow
a curved 3D torso (belly forward, waist back), so its top plunged into the chest
while its lower half floated in empty space in front of the receding thigh — it
"passes through the body". Confirmed visually with `model:preview` side views.

**Why it's a class of bug, not one model**: the real clothing helpers
(`F.clothing.top`/`pants`/`shoes`/`boots`) are built on the "clothing = body
region inflated + trimmed" rule — the actual body mass offset outward by `t` and
clipped to a zone, so a body can never poke through its own offset. But there was
**no apron/panel helper**, so every apron/bib/tabard/sash/cape is hand-rolled at a
guessed offset and re-introduces the same pass-through.

**Fix**: added `buildPanel` (exposed as `F.clothing.panel`) — a general
front/back-panel garment built with the SAME body-offset-and-clip rule, plus an
`F.clothing.apron` preset. `side: front|back|both`, named `top`/`bottom`
landmarks (or raw Z), `wrap`, `thickness`, `label`. Rewired
`examples/figure_chef.js` and the catalog code to use it. Verified manifold / 1
component / apron paints 2057 tris / no warnings, and prototyped the whole family
(bib/tabard/loincloth/cape) renders cleanly.

**Thickness must sit PROUD of the under-garments**: a first pass offset the apron
*less* than the jacket and `model:preview` correctly flagged "apron resolved to 0
paintable triangles — buried". The default `thickness` now clears the default
top+pants offsets with margin; documented the 0-triangle symptom in figure.md.

**What I deferred**: the catalog entry also stores a *baked* mesh + thumbnail.
Catalog sessions display the stored mesh and only re-run on user action, so the
code fix is correct-on-run and the cached preview is a benign stale snapshot.
Re-baking needs the heavy xvfb Playwright pipeline and would risk a lossy
single-version rewrite, so I kept the code fix and am filing a follow-up to
regenerate the chef thumbnail/mesh. Also filing a note to migrate other
hand-rolled front/back garments to the new helper.
