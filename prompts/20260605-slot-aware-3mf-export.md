---
session: "stylized-paint-effects"
timestamp: "2026-06-05T13:50:00Z"
---

## Human

Move onto the next phase (Phase 2: slot-aware multi-color 3MF export for
multi-color FDM / Bambu Studio AMS).

## Assistant

## Key decisions

**Slot-ordered 3MF materials.** `build3MF` previously built the `m:colorgroup`
in triangle-encounter order with the viewport default pinned at index 0. Replaced
that: emit the colours of the *used* filament-palette slots first, in slot order
(so the 3MF material index follows the user's AMS slot order), then any remaining
painted colours (custom + the unpainted default) in first-encounter order — and
only colours that actually appear in the mesh (no phantom default filament for a
fully-painted model). The exporter has only baked `triColors` (no slotId on the
mesh), and slot painting bakes the slot's exact hex, so an exact hex match against
`listFilaments()` recovers the slot order losslessly (hex→rgb→×255→hex is
identity). Unit-tested by painting two slot colours in non-slot order and
asserting the colorgroup emits them in slot order.

**Over-budget + format-honesty warnings (UI path only).** Extended
`ExportWarningInfo` with `colorOverBudget` (distinct region colours vs
`getPaletteCapacity()`, for 3MF/GLB/OBJ) and `colorDropped` (STL on a painted
model). Computed in `exportWarningInfo()` (the UI-only `confirmExportOrProceed`
path) so the console/AI `export3MF*` APIs stay unblocked. Advisory only.

**Bambu-native `paint_color` deferred — deliberately.** The user wanted faces
auto-assigned to filaments in Bambu Studio. That needs Bambu/Orca's per-triangle
`paint_color` segmentation, which is an *undocumented* bitstream (a recursive
TriangleSelector serialization). Web research surfaced the gotchas (uppercase-only
hex, 16-filament cap) but not a verifiable encoding, and a wrong encoding fails
*silently* in Bambu — worse than none. So Phase 2 ships the documented, portable
standard `m:colorgroup` (which Bambu imports as a multi-colour object, now in
slot order), and the native segmentation is held for a follow-up that can be
validated against a real Bambu Studio. Flagged to the user.

Layering: `src/export/threemf.ts` → `src/color/palette` (leaf) is a clean new
edge; `lint:deps` stays acyclic.
