---
session: "5ecjfq"
timestamp: "2026-11-15T17:42:00Z"
sequence: 14
---

## Human

Make the print preview show layered photo prints too. Being able to see the
print preview should also be an option when doing 3MF exports.

## Assistant

**Layered photo prints.** A layered print already records a swap plan
(filament blocks, each starting at a layer). `src/print/layeredPlanBands.ts`
turns that into the preview's bands, so the existing layer slider, cut and cap
work on it with no new rendering code. The preview now has two sources: the
object's own `api.print.layerColors` (which still wins when both exist, with a
warning), else the layered print's plan.

For the blending view I did not reuse the preview's generic estimate. The
print was solved against its own optical model, so the blend view asks that
model for the colour on top of each layer (`colorOnTopOf`, a new optional hook
on the split). Blending off shows the raw filament of every layer, which is
what a slicer's layer view shows and is new information for these models: the
viewport normally shows only the predicted result.

The plan is read-only in the panel (it comes from the solver and lives in the
`api.layeredPrint` call), so the edit controls are hidden and the rows name the
filament and its layer. `getLayerColors()` gains `source` and keeps `declared`
meaning "the code calls api.print.layerColors", so existing callers don't change.

**In the 3MF export dialog.** I read "an option" as: the dialog can show it on
request, without leaving the export. The object picker gets a Print preview
block, off until the user clicks Show (remembered per tab). It draws one ticked
object off screen from the export's own bake, so it shows what this export
writes: bands for a layer-coloured object, the object's paint otherwise (a new
`bandMeshFromColoredMesh` lets the layer slider cut a painted model too). It
never touches the viewport or the export choices. A generic 3MF carries no
layer colours, so there it shows the paint and says so.

The block's controls are added to the dialog only while shown; an existing
test counts the dialog's dropdowns, and a dialog that never asks for the
preview should be the dialog it was.

Parity: `openTool('export-objects', {printPreview: true})` opens the dialog
with the block showing and `toolState.printPreview` reports it; an agent that
wants to look uses `setPrintPreview` and renders.

Found on the way and filed, not fixed here: `runAndSave` saves the code as
passed while the editor auto-formats it, so the object reads as unsaved (#1263).
