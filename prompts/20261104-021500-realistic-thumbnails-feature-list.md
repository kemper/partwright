---
session: "01U8g7w9"
timestamp: "2026-11-04T02:15:00Z"
sequence: 17
---

## Human

Write the feature list per type and do the Realistic thumbnails.

## Assistant

## Key decisions

**Thumbnails come from the existing bake script.** `bake-character-presets`
gains `--family realistic`. It builds each Realistic preset as `api.human` code
with the same Node engine and gates as the Avatar bake (one manifold piece,
face present), renders the same front-¾ card, and writes
`public/character-presets/h-*.webp`. The default stays Avatar, so existing runs
change nothing. `--random N` checks the Realistic 🎲 Random the same way;
12 seeded rolls pass.

**The face gate differs by family.** `api.human`'s eye meshes are coarse (a
pupil can be 24 triangles), so the Avatar's 200-triangle buried-label bar
would fail every Realistic preset. Realistic only requires the eyes, and the
iris and pupil except on the toy's single bead.

**Cards match the Avatar ones.** They are the same height, show the baked
image, and fall back to the colour silhouette if an image is missing. A
browser test checks that the first card's image loads.

**The feature list lives where both audiences look.** A Realistic vs Avatar
table goes in `/ai/human.md#realistic-vs-avatar`, with a pointer from
figure.md, for agents. The help page gets a sentence on what each type adds
that the other doesn't, for users. Everything in the table was checked
against the two specs' option lists.

**A process slip, caught.** The first edit to the bake script failed on a
wrong anchor, but the bake ran in the same command, so the unedited script
re-baked every Avatar thumbnail. The output was byte-identical (git showed no
change), so nothing was lost. The edit and the bake then ran as separate
steps.
