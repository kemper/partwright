---
session: "01WC8YXHxrUV4eQyV6dr8i6k"
timestamp: "2026-06-06T16:20:00Z"
model: claude-opus-4-8
tools: []
sequence: 3
---

## Human

The "Keep side" inside/outside toggle doesn't make sense — most people will
want to keep both sides. Also the re-cut feedback loop where Apply triggers
the auto-preview again needs to be fixed.

User confirmed via AskUserQuestion:
- Keep Side → "Always both, drop the toggle"
- Re-cut loop → "Fix it now"

## Assistant

## Key decisions

**Drop `keepSide` entirely** — always produce both sides.

Removed from every layer of the stack:
- `CutParams.keepSide` in `cutWorker.ts`
- `buildCutter()` keepSide parameter — plane now always subtracts the -Z
  half-space; `performCut()` always does `subtract` for one side and
  `intersect` for the other (both sides are returned in `keptMeshes` /
  `complementMeshes` as before, so the exploded-view preview is unchanged)
- `CutGizmoParams.keepSide`, `KeepSide` type, `getKeepSide()`/`setKeepSide()`
  exports from `cutGizmo.ts`; also removed the plane direction arrow
  (`planeDirArrow`, `buildArrow`, `updateArrow`) whose only purpose was
  showing which side was kept
- "Keep Side" UI section in `cutUI.ts`; removed `setKeepSide`/`getKeepSide`/
  `KeepSide` imports
- `keepSide` parameter from `cutInWorker()` in `engine.ts`, the Worker message
  type comment in `engineWorker.ts`, and the `performCut()` call there
- `params.keepSide` from the `apply()` handler in `main.ts`

**Fix the re-cut feedback loop** — two complementary fixes:

1. **`suppressCutGizmoUpdate` flag** (in `main.ts`): set to `true` around the
   `applyLiveGeometry(meshToShow)` call in `apply()`. `applyLiveGeometry`
   calls `onCutMeshChanged(mesh)` which re-centers the gizmo and fires
   `notifyChange()` → the 300 ms debounced auto-preview → another `apply()` →
   loop. The flag short-circuits the `onCutMeshChanged` call during a cut
   apply, so the gizmo stays put and no new preview is scheduled.

2. **Removed `cutBaseMesh = result.mesh`** after `apply()`. That line advanced
   the baseline after every apply, so each auto-preview compounded on the
   previous cut result (~9× in testing). The baseline now stays fixed at the
   mesh present when the panel was opened; re-applying always cuts the original.
