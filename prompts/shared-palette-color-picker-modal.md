---
title: Shared palette colour-picker modal replacing native OS pickers
date: 2026-06-21
labels: [enhancement]
---

## Human

I think all moments where we have a color picker from places like that, I
think we should pop up a modal with a pallet color picker and within the pallet
color picker is a complete freeform color picker that then adds that new color
to the pallet when it's picked.

(Follow-on to the per-part label swatch, which used the native OS picker.)

## Assistant

**Two clarifications resolved with the user first** (both change the build):
1. *New freeform colour →* add to the **"Recent" history** (`recordColor`), not a
   permanent filament slot. Slots map to real filaments, so promotion stays an
   explicit action in the palette manager — auto-adding every ad-hoc colour
   would balloon the slot list.
2. *Scope →* **all** native `<input type="color">` pickers app-wide.

**New shared component — `src/ui/colorPickerModal.ts`:**
- `openColorPicker({ initialHex, title?, onPick, onClose? })` — a stacked overlay
  (its own `z-[60]` overlay, **not** the singleton `createModalShell`, because it
  is frequently opened from inside another modal/panel and modalShell would
  force-close the parent). Shows the active palette's slots and the recent-colour
  history as one-click commit swatches, plus a freeform native picker + hex input.
  Palette/recent clicks commit immediately; the freeform pick commits via Apply
  and is recorded to Recent.
- `createColorSwatch({ initialHex, onPick, ... }) → { el, setHex }` — a swatch
  button that opens the picker; the drop-in replacement for a native
  `<input type="color">` styled as a swatch. Stops click propagation (so a swatch
  inside a clickable row doesn't also trigger the row).

**Wired every call site** to the shared picker: paint panel (custom colour,
per-label part swatch, region-list swatch), surface modal custom colour, params
panel `color` field, relief studio region swatch, annotation custom colour,
voxel paint custom colour, image-paint background-colour picker, and the two
image→voxel import modal pickers (TSX → button + `openColorPicker`). The palette
manager's own slot editor stays a direct native picker on purpose (editing a
slot's colour shouldn't reopen the palette).

**Layering:** added a `ui → color/palette` import edge; `lint:deps` confirms the
graph stays acyclic.

**Tests:** new `tests/color-picker-modal.spec.ts` (palette-swatch commit +
freeform→Recent). Updated `paint-labels-panel` and `paint-palette` specs that
previously drove the native `<input type="color">` to go through the modal.
