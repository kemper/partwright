---
session: "01WC8YXHxrUV4eQyV6dr8i6k"
timestamp: "2026-06-06T16:40:00Z"
model: claude-opus-4-8
tools: []
sequence: 4
---

## Human

The realtime preview is too aggressive. Add a "Real-time preview" checkbox (off
by default). Rename "Apply Cut" to "Preview Cut" since that's what it does.
Hide the cut menu after a cut is saved — otherwise it tries to preview-cut the
new parts too.

## Assistant

Three changes to `src/ui/cutUI.ts`:

**"Real-time preview" checkbox (default off):** Added `realtimePreview = false`
module variable. The `onGizmoChange` auto-preview timer is now gated: it only
schedules if `realtimePreview` is true. When the checkbox is unchecked the
gizmo can be dragged freely with no automatic preview — the user clicks
"Preview Cut" explicitly. The checkbox lives in the Options section alongside
"Preserve colors" and "Show gizmo handles".

**Rename "Apply Cut" → "Preview Cut":** The button title and status messages
updated to reflect the actual behavior (renders exploded view in the viewport;
Save is the commit step). "Applying cut…" → "Previewing cut…" and
"Cut applied — N triangles" → "Preview ready — N triangles".

**Auto-close after Save:** `doSave()` calls `closePanel()` on `res.ok`. This
deactivates the gizmo and cancels any pending preview timer, so the newly
created parts are shown cleanly without the panel trying to preview-cut them.
