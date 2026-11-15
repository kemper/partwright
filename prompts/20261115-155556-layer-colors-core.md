---
session: "5ecjfq"
timestamp: "2026-11-15T15:55:56Z"
sequence: 6
---

## Human

Wants an in-app preview of models as they would look sliced, specifically
models that print different colours at different layer heights (filament
changes placed on the slicer's layer slider). Asked whether that means
running or simulating the slicer. Layers are normally opaque; a checkbox for
an estimated blending preview would be welcome.

## Assistant

## Key decisions

**No slicing needed; colour is a function of height.** A filament change at a
layer makes every layer one colour, so the preview can be the existing mesh
coloured in bands snapped to layer boundaries. This commit is the pure logic
for that, with no UI yet.

**Measured the slicer's behaviour before modelling it.** Using the slicer
check tool on hand-edited project files:
- A filament switch is a `type="2"` entry in
  `Metadata/custom_gcode_per_layer.xml`, and its `top_z` is the TOP of the
  first layer printed in the new filament (an entry at 8.0 with 0.2 mm layers
  turned the 7.8-8.0 layer, not the 8.0-8.2 one). So "from height z" must be
  written as the boundary nearest z plus one layer height.
- On an object that also has per-triangle paint, the slicer ignores these
  entries completely (identical filament weights and change count with and
  without them). Layer colours and paint cannot be combined on one object;
  the UI will have to say so rather than preview something that won't print.
- `type="0"` is a manual swap on the same slot: one filament in the slicer's
  accounting, so its colour comes only from the entry.

**Verified the module end to end against a real slice.** Off-boundary requests
(5.07, 11.93, 20.1 mm) were resolved to bands, serialised by this module,
injected into a project file and sliced. The G-code's walls change filament
at exactly the predicted layers. On a transition layer the outgoing filament
still prints prime tower and sparse infill (flushing), which is not visible,
so the band model is right for what you see.

**User-facing unit is "from this height up, colour X".** Slots and entry types
are an export detail: the exporter maps colours to filament slots. Changes
that snap to the same layer, repeat the current colour or sit above the model
are dropped when bands are resolved, so the preview and the file can't
disagree.

**The blend estimate is explicitly an estimate.** Layers under a top surface
are composited top-down with a per-filament transmission distance; the
function takes that and the look-down depth as parameters instead of
hardcoding tuning values, which belong in app config when the UI lands.

**Not pushed.** The branch still carries an open, green tooling PR; pushing
product code there would change what is about to be merged. This waits for
that merge and gets its own PR.
