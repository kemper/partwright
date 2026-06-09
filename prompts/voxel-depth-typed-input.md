---
session: "01EDqE"
timestamp: "2026-06-09T10:00:00Z"
---

## Human

I just merged a voxel studio update but I want the depth slider to accept a
typed number. Even though the slider goes up to 16 I don't want a hard max on
the typed in value. Make a PR.

## Assistant

## Key decisions

**Split the convenience range from the allowed range.** The depth slider stays
a 0..16 range input (a comfortable drag for the common case), but the *stored*
value is no longer clamped to 16. `setAddDepth` in `voxelPaint.ts` dropped its
`Math.min(MAX_ADD_DEPTH, …)` (and the now-unused `MAX_ADD_DEPTH` const) so it
keeps any non-negative integer. The lower bound (`Math.max(0, …)`) is kept —
negative depth is meaningless.

**Typed input mirrors the existing paint-depth pattern.** Rather than invent a
new control, I followed the precedent already in `paintUI.ts` (the brush
paint-depth row: a range slider beside a `type="number"` input with `min=0` and
*no* `max`, commented "type past the slider"). The voxel depth section now has
the same slider + number-input row. The number input commits on `change`/Enter,
rejects negatives/NaN by reverting to the current value, and has no `max`.

**Keep the slider and input in sync without fighting the user.** On refresh the
slider clamps its displayed value to its own max (`Math.min(16, depth)`) so its
thumb pins at the right edge for deeper values, while the number input shows the
true stored depth — but only when it isn't the active element, so typing isn't
clobbered mid-edit.

**Parity + docs.** The console/AI path (`setVoxelBrush({ depth })` in `main.ts`)
already delegated to `setAddDepth` and validated only `depth >= 0`, so it
inherits the no-max behavior for free — I updated its JSDoc and the
`public/ai/voxel.md` entry, both of which still said `0..16`. Added a
`voxel-studio.spec.ts` golden-path test that drives both the API and the panel's
number input with values past 16 and asserts neither re-clamps (slider thumb
pins at ≤ 16, stored depth is the typed value).
