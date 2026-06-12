---
session: "1279354d"
timestamp: "2026-06-12T00:55:10Z"
model: claude-opus-4-8
---

## Human

(After a research + accounting session on the Figure API.) "Do the developer
experience PR first." The DX PR was scoped earlier as: add the two-handed prop
primitive `F.spanGrips`, add a deterministic pose readout `F.poseProbe`, give
the existing `holdAt` helper a genuine in-tree consumer (it shipped in #601 with
unit tests but no caller — a dead-export risk), and rebuild the rocker's guitar
on the new span primitive.

## Assistant

## Key decisions

**`spanGrips` returns a data frame, not a transformed Node.** `holdAt` takes a
prop and returns it oriented/seated. `spanGrips` instead returns a `SpanFrame`
`{a, b, axis, length, mid}`. Reason: two-handed props are rarely a single
symmetric bar centred on the span — the guitar has a body at one end and a
headstock past the other; a barbell has plates at the ends. The frame is what
those constructions actually consume (`sdf.capsule(s.a, s.b, r)` is then a
one-liner, and end-growth keys off `s.axis`). A prop-seater would not have fit
the rocker. It accepts grip frames OR raw `[x,y,z]` (via `asPoint3`) so it also
spans arbitrary joints, and guards the degenerate `a == b` case to a safe
`[0,0,1]` axis instead of NaN.

**`poseProbe` returns structured data + a `.text` summary, rounded to 2dp.**
This replaces the hand-rolled `throw new Error(JSON.stringify(...))` scratch
probes used repeatedly when authoring poses (flagged across multiple retros).
It dumps every joint, both grip frames, and the direction set. No CLI
`--joints` flag: `model:preview` runs arbitrary model code returning a Manifold
and can't generically recover the rig, and capturing sandbox console would
risk polluting the JSON stdout. `throw new Error(F.poseProbe(rig).text)` from a
model file (or `console.log` in the browser) is the intended deterministic dump
— which dogfooded itself while tuning the new staff-mage pose.

**Rocker rebuilt on `spanGrips` as a pure geometric no-op.** The neck/headstock
hand-rolled vector math (`nDir`/`nLen`/`nN`) became `F.spanGrips(neckStart,
gL.point)` → `neck.axis`/`neck.b`. Verified byte-identical to `origin/main`
(volume 8950.147997… to 12 digits), so the change is source-clarity only. The
catalog `rocker.partwright.json` was already stale vs main (a guitarist fix
merged without a rebake), so it was rebaked — manifold, 1 component, genus 2,
all 11 labels.

**`holdAt` consumer = new `figure_staff_mage.js` (not a chibi_wizard reuse).**
chibi_wizard's staff is a *planted vertical* staff — a `placeAt`+weld case, not
a `holdAt` case (whose job is making a prop FOLLOW the grip). So a new figure
is the honest consumer: a mage whose quarterstaff is built centred on local +Z
and seated with `F.holdAt(staff, rig.grip.R)`, lying in the hand at its natural
angle. Pose refinement (incl. dogfooding `poseProbe` to read `grips.R.gripAxis`)
was delegated to the `model-sculpt` subagent to keep preview PNGs out of the
main context.

**Parity:** these are sandbox model-authoring helpers on `api.sdf.figure`
(like the pre-existing `holdAt`/`placeAt`), documented in `public/ai/figure.md`
— not `window.partwright` console methods or UI buttons, so the UI↔API parity
checklist doesn't add a surface here.
