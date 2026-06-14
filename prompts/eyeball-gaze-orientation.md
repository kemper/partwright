---
session: "01KppwEW"
timestamp: "2026-06-14T15:10:00Z"
---

## Human

Add a feature so the eyeballs (the pupils/irises) can have different
orientations. The exact orientation should be definable with broad numbers in
some sensible way, but there should also be concrete presets — middle, left,
right, up, down, upper-left, upper-right, lower-left, lower-right. It should be
definable per-eyeball (so a figure can be cross-eyed or have one independent
eye), but the typical/default case applies the same orientation to both eyes.
Flexible on the exact API. Implement it and create a PR.

## Assistant

## Key decisions

**Gaze re-aims the existing iris/pupil plug — no new geometry.** `buildEyes` in
`src/geometry/sdfFigure.ts` already builds each iris/pupil as a cylindrical plug
clipped to a sphere concentric with the eyeball. To steer the look I rotate that
plug **about the eyeball centre** (the origin, before `orientToHeadPose` carries
it into the posed head frame) by a `{ yaw, pitch }` pair. The cap sphere is
origin-centred, so rotating about the centre keeps it concentric — only the disc
re-aims, with no bead/bump. Zero gaze skips the rotation entirely, so every
existing figure renders byte-identical (backward compatible).

**Convention: `yaw` > 0 = the figure's OWN left, `pitch` > 0 = up.** Asked the
user whether "left" meant the figure's left or the viewer's left; they chose the
figure's own left. That matches the `eyeL`/`eyeR` naming and makes cross-eyed =
`gazeL:'right', gazeR:'left'`. Verified the sign empirically with colored
`model:preview` renders (front view): the `'left'` preset shifts both irises to
+X = the figure's left, and `gazeL:'right'+gazeR:'left'` converges on the nose.

**Three keys, presets OR explicit angles.** `gaze` aims both eyes; `gazeL` /
`gazeR` override one eye and fall back to `gaze`. Each accepts a named preset
(the nine cardinal/corner directions, with `'middle'`/`'center'` straight ahead)
or a `{ yaw, pitch }` pair in degrees (clamped ±45). Parsing reuses the existing
`assertEnum` / `assertObject` / `assertNoUnknownKeys` validators, so unknown
presets/keys and out-of-range angles throw with the same messages as the rest of
the figure DSL. This is a code-authoring DSL feature (`F.face.eyes`), not a
`window.partwright` method or UI button, so the UI↔API parity checklist doesn't
apply — documented in `public/ai/figure.md` (the surface external/in-app agents
read).
