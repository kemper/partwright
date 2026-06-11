---
session: "01NTQB"
timestamp: "2026-06-10T20:30:00Z"
---

## Human

(Round 4 on the engrave modifier, PR #559.) "That is getting better. Rather than
a popup, I'd prefer we literally show the same 'Rendering …' message (with the
cancel link) we show when rendering other things — not the modal. It's also
awkward that it renders the text as it's being typed; there should be a small
apply button to the right of the text. There's a capability gap too: 'Place on
face' doesn't work well with cylinders, and 'Cylindrical wrap around Z' doesn't
either (on the lighthouse I don't even see the text). I think 'Place on face'
should be the only way it works, but with a curvature modifier so it can wrap
around X, Y, or Z — though X/Y/Z only makes sense relative to the plane of the
text. Finally, the text-size and engrave-depth sliders should accept typed
values beyond the slider max."

## Assistant

## Key decisions

**Inline "Rendering…" indicator instead of the modal.** `buildSurfaceModifierProgress`
no longer opens the progress modal; it drives the same status-bar timer the
normal run loop uses (`startRunTimer`/`stopRunTimer` → "Rendering… Xs") and a
new `surfaceCarveCancel` override on the toolbar Cancel button, which aborts the
SDF sweep when a carve owns it (otherwise it falls back to `cancelCurrentExecution`).
The superseded-carve guard only stops the timer when the settling carve is still
the current one, so rapid slider edits don't fl/icker the indicator off.

**Place-on-face is the only placement; curvature replaces wrap-around-Z.** Dropped
the Projection dropdown and the cylindrical option from the Surface panel.
Placement is always click-to-place (planar snap on axis-aligned faces, free on
sloped/curved). Added an `EngraveCurve = { axis: 'u'|'v', angleDeg }` to the
planar/free `EngraveProjection` variants: `engraveCombine` was refactored so
planar and free both reduce to a `(du, dv, nOut)` local frame, then a shared
flat-or-curved map bends one in-plane axis around a cylinder whose surface passes
through the placement point (so curve→0 reduces exactly to the flat field, which
the unit test pins). `'v'` wraps left↔right (a tower/mug); `'u'` wraps up↔down
(a dome). The wrap radius is derived from the stamp size and `angleDeg`. The
legacy `cylindrical` projection stays in the type/geometry/console form for
back-compat but is out of the UI. Exposed via the AI tool as flat
`curveAxis`/`curveAngleDeg` fields and documented in `textures.md`.

**Apply-the-text button; no render-on-type.** Typing no longer rebuilds the mask
on every keystroke. A small "Apply" button next to the text field (id
`engrave-apply-text`, aria-label "Apply text" to keep it distinct from the footer
Apply) and the Enter key rasterize + preview on demand. Font/image changes still
rebuild immediately.

**Typed values beyond the slider max for size/depth.** `sliderWithEntry` gained
an optional fractional `round` (it rounded to integers — fine for resolution,
wrong for size/depth). Text size and engrave depth now use it with hardMax of
8×/4× the model span and a 3-decimal round, so power users can type a wider/deeper
value than the slider exposes (the thumb pins at the slider max).

## Verification

Browser (Playwright scratch specs, screenshots posted): the engrave panel shows
the Apply-text button, no projection dropdown, the Curve dropdown + Wrap-angle
slider, and number boxes on size/depth; an API-driven `curve:{axis:'v'}` carve
wraps "PARTWRIGHT" around a cylinder's side (letters follow the curvature).
Unit: curvature reduces to flat at a tiny angle, still carves at center under a
strong wrap, and `engraveMesh` stays non-degenerate when curved (1068 unit tests
green). E2e: updated the panel test to press Apply-text; added a `curveAxis` API
case (9/9 engrave specs green). `typecheck` + `lint:deps` (acyclic) clean.
