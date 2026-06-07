---
session: "01ML8c"
timestamp: "2026-06-06T13:30:00Z"
---

## Human

Undo and redo don't respond to keyboard shortcuts. I also want to be able to
update the existing code if the code was procedurally making a voxel instead of
"Bake" being the only option. I also don't want to call it bake but instead
call it "save as raw voxel data" and warn them it'll replace the code if there
is any. Generally, look at the current state of painting, menu design
(draggable, closeable via esc, etc.) and ensure you're matching the idioms and
usability patterns of the rest of the app.

(Clarified: "Update code" should append explicit `v.set`/`v.remove` ops after
the existing code; "Save as raw voxel data" replaces with `voxels.decode(...)`
of the full grid — still an editable voxel session, not a baked mesh.)

## Assistant

## Key decisions

**Keyboard undo/redo routed centrally, not via a private listener.** The app
already has one `keydown` router (`src/ui/keyboardShortcuts.ts`) that scopes
undo/redo to the active tool (paint regions, annotation strokes). Added a voxel
branch there for consistency. Placed it *before* the `isEditableTarget` guard
and gated on `isVoxelStudioActive()`, because the studio locks the code editor —
so even if the (read-only) CodeMirror holds focus, Cmd/Ctrl+Z must reach the
studio rather than fall through to the editor's native undo.

**"Update code" appends a diff, doesn't re-encode.** The honest way to preserve
procedural source is to keep it and add only what the user did by hand. Snapshot
the grid at activate (the code's own output), diff it against the edited grid at
commit, and emit `v.set/v.remove` lines. To stay robust against any return shape
(`return v;` vs `return voxels()...chain;`), `appendVoxelEditsToCode` binds the
final return expression to a local and applies the ops to that, rather than
trying to find a user variable. Falls back to a full decode replace if there's
no trailing `return`. Pure + unit-tested (`editCodegen.ts`).

**Confirm lives in the UI layer, not the core commit.** "Save as raw voxel
data" overwrites code, so the button confirms via the shared `confirmDialog`.
But the programmatic `bakeVoxelsToCode()` (AI / automation / e2e) must not block
on a dialog, so `commitVoxelEdits()` is confirm-free and the UI callback owns
the prompt. Kept the API name `bakeVoxelsToCode` for back-compat; added
`updateVoxelCode` for the new path.

**Matched the Paint panel's idioms instead of inventing new ones.** Reused
`attachViewportPanelDrag` + `setInitialPanelPosition` (drag handle + reset
position), the `viewportPanelRegistry` (one overlay panel open at a time — so
opening Paint closes the studio and vice-versa), the header `× ` close button,
and the `Escape`-to-close pattern (deferring when a `[role=dialog]` is open).

**Enter/exit side-effects moved into `syncActiveState`, guarded by a transition
check.** The studio is opened both from its button *and* programmatically
(`activateVoxelPaint`, used by the AI and tests). Positioning/registry/Esc must
fire on either path, but must NOT re-run on every state refresh (that would
reset the panel position mid-drag). A `was-active → now-active` edge guard gives
exactly-once enter/exit. This also fixed a real bug where API activation left
the panel unpositioned, collapsed to ~0 height — the panel must anchor to the
viewport pane (`controlsContainer.parentElement`), not the small top-right
toolbar box, or `max-h-[calc(100%-…)]` measures against the wrong element.
