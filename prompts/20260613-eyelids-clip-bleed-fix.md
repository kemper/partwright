---
session: "01DnBahfEetNH5Enmu5CbJPB"
timestamp: "2026-06-13T21:50:00Z"
model: claude-opus-4-8
---

## Human

On the eyelid PR preview, reported that the eyelids look "cut open where the
iris and pupils are" — the iris/pupil show through the lid. Wanted the lids to
overlay the iris/pupil (and fully cover them when closed). Suspected "the iris
painting happens late and bleeds onto the eyelid."

## Assistant

## Key decisions

**Diagnosis confirmed the user's hypothesis.** The iris/pupil/sclera were built
as full discs that extended UNDER the lid, relying only on the hard-union to
bury the covered part. The lid sphere (≥1.2·rad) sits just in front of the
iris/pupil discs (≈1.01–1.02·rad) — a ~0.18·rad gap. In the browser paint path
(`paintByLabels` → `commitWithColors`) the covered iris/pupil label sat a hair
behind the lid surface and bled its colour onto the lid; a posed head could also
poke the disc through. The pure `model:preview` resolver happened to render it
correctly (exact `runOriginalID` provenance), which is why it only showed in the
deployed catalog — reproduced it by baking through `build-catalog-entry.cjs`
with a magenta-iris / green-lid palette.

**Fix: clip the eye to the opening.** Build the lid as an UNLABELLED solid once,
then `subtract` it from the sclera/iris/pupil before labelling, so no eye
geometry survives under the lid. With nothing there, the lid is an opaque skin
fold — can't bleed, can't poke — and `closed` fully hides the eye. Verified the
browser bake path is now clean (green lid cleanly rings the iris opening) and on
the real afro-funk figure.

**Re-baked all 15 catalog figures** since the clip changes the eye meshes
(triangle counts / colour regions). All stayed manifold, `componentCount 1`,
`lids` label resolves. Unit tests unchanged (152 pass) — the label contract is
the same; only the covered geometry is removed.
