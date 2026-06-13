---
session: "elegant-clarke-25f7wu"
timestamp: "2026-06-12T18:28:00Z"
model: claude-opus-4-8
tools: [playwright]
sequence: 3
---

## Human

Could we make the hiding happen more smoothly? It's a very sudden jump and would
be nicer as a smooth animation slide type of effect. It can still be a bit quick
but I want it to slide away.

## Assistant

## Key decisions

**Slide via layout footprint, not just a visual transform.** The docked AI panel
is a real flex child, so the jump came from toggling `display:none`. Animating
only a `transform` would slide the panel but the viewport would still snap wider.
Instead the close animates `margin-right` from `0` to `-panelWidth`: the panel's
layout contribution shrinks to zero, so the viewport grows into the space *as*
the panel slides off the right edge — both move together. The panel keeps its
width throughout, so its content never reflows/squishes.

**No new clipping needed.** A panel at `margin-right: -panelWidth` overflows to
the right, but `body` is already `overflow-hidden`, so it's clipped — no
scrollbar flash, no change to `#app-row`.

**The 3D canvas stays crisp.** The viewport resizes off a `ResizeObserver` on its
container, which fires every frame during the CSS transition — so the canvas
tracks the growing width smoothly instead of stretching then snapping.

**Width is deliberately excluded from the transition** so live panel-resize
dragging stays snappy; only `margin-right`/`transform` animate.

**Reduced-motion + boot-instant.** `effectiveSlideMs()` returns 0 when the OS
requests reduced motion, and also for the very first show/hide (the boot-time
restore of the remembered open state) so the editor doesn't slide-in during load.
Mobile (full-screen `fixed` overlay) uses `translateX(100%)` since margin doesn't
apply there.

**Config, not a magic number.** Duration lives in `appConfig.ui.aiPanelSlideMs`
(default 200ms) with an Advanced Settings field, per the repo's no-hardcoded-knob
rule.

**Verification.** Captured a slowed-down (1200ms) mid-slide frame showing the
panel caught partway off-screen with the viewport grown into the gap. Existing
visibility e2e (customizer `toBeHidden`, ai-customizer-defer `toBeVisible`, the
smoke panel toggle/persist suite) all still pass — Playwright's auto-retry
absorbs the ~200ms before `hidden` lands.
