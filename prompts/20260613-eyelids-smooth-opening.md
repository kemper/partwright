---
session: "01DnBahfEetNH5Enmu5CbJPB"
timestamp: "2026-06-13T23:15:00Z"
model: claude-opus-4-8
---

## Human

On the high-res preview the eyelids looked "cut out" — a jagged RECTANGLE
carved around the iris/pupil (clearest on the ballerina, an `almond` eye).
Noted that many styles looked fine and "maybe it's just one type." Also pushed
back that my earlier preview crops were too low-res to judge.

## Assistant

## Key decisions

**Root cause: box-cut openings.** The lid was built from up to four planar
half-space caps (top/bottom on Z, two corners on X) and the eye was clipped to
their complement. With only Z caps (`upper`/`hooded`/`half`/`closed`) the
opening is a clean horizontal band — those looked fine. But `almond`/`tapered`
add the X corner caps, so the opening becomes a hard RECTANGLE (two Z planes ×
two X planes), which meshes into a jagged box at eye resolution — the "cut out."

**Fix: one smooth elliptical opening.** Replaced the cap union with a skin DOME
(`sphere(lidR) ∩ front`) through which a smooth ELLIPSOID — stretched into a tube
along the view axis — cuts the eye window. `lid = dome − opening` (labelled
`'lids'`); the eyeball/iris/pupil are intersected with the opening so they exist
only in the window (no bleed, no poke; `closed` = no opening, eye removed under
the dome). Per-style params are now the opening's half-width / half-height /
vertical-centre + dome scale. The opening edge is a clean curve at every angle.

**Verified at high resolution.** Earlier crops were upscaled from 480px tiles —
mush. Now rendering at `--size 1400` and cropping natively. All seven styles
render clean (no rectangle, eyeball inset naturally under skin lids); re-baked
all 15 catalog figures. Unit tests unchanged (152) — the label contract
(`'eyes'`/`'iris'`/`'pupil'`/`'lids'`, solid self-labels with lids) is the same.

**Genus blow-up — keep the eyeball WHOLE.** A first pass clipped the eyeball
itself to the opening (a lens), so the lens and the dome shared the opening's
tube wall and produced dozens of handles (ballerina genus 1 → 26,
locs-musician → 126). Fix: leave the sclera a full sphere so it fills behind the
dome's hole (one solid mass, no nested tube walls), and clip ONLY the iris/pupil
discs to the opening (enough to stop the colour bleed). Genus dropped back to the
originals (ballerina 1). Lesson: check `genus` after any boolean-heavy change,
not just `isManifold`/`componentCount`.

**Also bumped the `model:preview` default to `--size 768`** and documented a
high-res QC pass in CLAUDE.md (hunt for defects/irregularities/colour bleed at
`--size 1200+`, crop natively) — the rectangle was invisible at the old default.

## Process note

Always verify fine facial features at high resolution (`model:preview --size
1200+`, crop natively — never upscale a small crop). The rectangle was
invisible at the default 480px tile; the user caught it before I did.
