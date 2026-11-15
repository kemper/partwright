---
session: "5ecjfq"
timestamp: "2026-11-15T17:55:00Z"
sequence: 15
---

## Human

Make the print preview show layered photo prints too, and make it available
when doing 3MF exports. (This commit acts on the review of that work.)

## Assistant

**Enter must not export.** The export dialog confirms on Enter from anywhere
inside it, and the preview block added the dialog's first text field. Typing
a layer number and pressing Enter would have written the 3MF. The block now
keeps its own Enter presses to itself. I fixed it in the block, not in the
shared confirm guard, so the dialog's existing Enter behaviour on its other
controls is unchanged.

**Blending on a big layered print.** The blend view split every triangle at
every layer top. Now walls and undersides are split at the colour changes
only (they never blend), and with a supplied prediction a plane is added only
where the predicted shade actually changes. A 2M-triangle layered print goes
to about 2.05M triangles in under half a second, where the reviewer measured
a sevenfold growth on a smooth test surface.

That makes neighbouring faces split differently, so the same cut point can
arrive with slightly different coordinates from each side. The outline
matching was a rounded-key lookup, which fails at a rounding boundary; it is
now a tolerance match (same cell or its neighbours). A new test cuts a gabled
shape, where vertical walls share sloped edges with blended roof faces.

**Smaller:** a render still in flight can no longer draw an unticked object;
the dialog draws very large objects from the simplified proxy; a panel draft
is dropped when a run turns the object into a layered print (its swaps are
read-only there); the export preview's memo key includes the layer heights.

**Left:** swaps above the top of a short model are still listed in the panel.
