---
date: 2026-06-18
branch: claude/busy-clarke-cd0e1w
files_changed:
  - src/ui/progressModal.tsx
  - src/color/paintMode.ts
  - src/color/paintUI.ts
  - src/main.ts
  - tests/paint-cancel.spec.ts
---

## Human

When the "Refining mesh under the stroke" modal pops up during painting, the user
wanted it to also surface a tip — at minimum a message like "did you know you can
disable edge smoothing for faster painting?" with a way to act on it. Ideally a
button that both stops the current operation AND disables edge smoothing in one
click, so people can escape a slow stroke and not hit the same wait next time.
Definitely for paint, but written so other long operations could reuse the same
affordance.

## Assistant

Extended the shared progress modal (`progressModal.tsx`) rather than special-casing
paint: `startProgress` now takes an optional `hint` (a 💡 tip line under the
message) and an optional `secondaryAction` ({ label, onClick }) rendered as a
button left of Cancel. Generic by design so any multi-second operation can offer a
"speed this up" affordance — the modal just renders what the caller passes.

Wired it into both paint-refine progress modals in `main.ts` via a small
`paintRefineSmoothingExtras(abort)` helper. The secondary action aborts the
in-flight job (so it doubles as Cancel) AND calls `setBrushSmooth(false)`, then
toasts a confirmation. Gated on `isBrushSmooth()` being on — so we never offer to
disable something that isn't the cause (e.g. a spray stroke refining with smoothing
already off): returns `{}` and the button/tip don't render.

To keep the paint panel's "Smooth edges" toggle in sync after a programmatic
disable, added a single-slot `onBrushSmoothChange` listener to `paintMode.ts`
(mirroring the existing `onReplaceSourceColorChange` pattern) and registered the
panel's `syncSmoothToggle` against it in `paintUI.ts`.

Verified the modal rendering in-browser via a throwaway spec (screenshot posted),
then added a permanent golden-path e2e in `paint-cancel.spec.ts` that drives a real
smooth stroke, clicks the new "Stop & turn off smoothing" button, and asserts the
modal hides and `getBrushSmooth().smooth` is now false. Typecheck, unit tier, build,
and the full paint-cancel spec all green.
