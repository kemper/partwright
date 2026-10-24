---
session: "01BsPPSVZ2oFGFXTxRyBtu1M"
timestamp: "2026-10-23T18:35:00Z"
tools: [subagent, git-worktree, playwright]
---

## Human

Do all remaining follow-ups of #1050.

## Assistant

## Key decisions

**Brush-merge is a new `brush` edit op, not a batch of `reassign`s.**
`{op:'brush', to, points+radius | triangles, mode:'triangles'|'patches'}` is
one stroke and one undo step. `triangles` mode moves the brushed triangles and
fixes them, like the Fix brush. `patches` mode moves every part the stroke
touches whole, pins and locks included, using merge's rules. A dab smaller than
the triangle it lands on still takes that triangle, so coarse CAD meshes work
too. The console, the AI tool schema, `help()` and the docs all get the op.

**The Select-tool brush targets the part where the drag starts.**
- A plain drag that starts on a part brushes into that part. A press off the
  model still orbits.
- Alt-drag uses `patches` mode.
- The ghost preview is computed on the main thread against the overlay mesh
  the viewport already shows. It covers the brushed triangles plus the faces
  the pointer crossed, in the target's colour. No Worker round trip is made
  per move.
- Touch is excluded: a one-finger drag keeps orbiting there, and the Fix tool
  brushes on touch screens.

**Selections start empty.**
- The brush clears the selection when it starts and again after it lands.
- Shift-drag paint-select now starts a fresh set. A Shift-click without
  moving still toggles.

**Type-to-name only with exactly one part selected.**
- Letter shortcuts (V/P/B/S/H/M) would otherwise collide with names: "shirt"
  would hit Solo on its first letter. So letters go to the rename popover only
  when one part is selected.
- R always opens the popover, for the part under the cursor.
- The popover lists the existing parts ("merge into") and the chip names. It
  reuses `rename`'s merge-on-taken-name rule. A chip name also gives a fresh
  part the chip's colour.

**Keys.**
- M merges the selection.
- Enter accepts, except when a text box or button has focus.
- 0 picks the tenth chip ("base").
- These are listed in the `?` sheet.

**Smarter defaults.**
- **Fused figure:** a 1–2-piece Separate-pieces proposal whose largest piece
  is at least `fusedPieceMinTris` triangles counts as a fused figure, via one
  pure helper (`isFusedPiecesDraft`) that main.ts and the panel share. The
  panel opens with the first chip armed. The method switch to Crease watershed
  waits until the first pin, so the proposal survives until the user commits.
- **Import banner (root cause 7):** the banner now says "found N separate
  parts, and the largest is one fused solid…". The in-list amber note is
  reworded the same way and hidden while the banner shows, so the panel no
  longer contradicts itself.
- **Start section:** it folds into a summary line once a draft exists. The
  chips stay visible.
- **Method changes:** any method change now clears the draft, with Undo.
  Seeded → seeded is the exception, because the pins are the next method's
  input.
- **Auto-absorb:** after detection and after each pin re-grow, specks under
  `autoAbsorbSpeckFrac` (0.2%) are absorbed. Triangles under placed pins,
  hand-fixed triangles and anything outside the edit's allow-mask get the
  whole surface's weight in `absorbSmallRegions`, so the draft's own pins and
  fixes are never eaten.
- **Missed pins:** every placed pin is checked, not only chip pins. A missed
  pin gets a toast, and its row shows ⚠ with its size.

**Phone.**
- Below 768 px the panel is a bottom sheet (`mobileSheetHeightFrac`, 45%).
  It is re-applied after a header drag or resize.
- Rows show the swatch, name and size. The rest folds into a ⋯ menu that
  reads the selection and solo state when it opens.

**Paint panel.**
- The Labels list moved up under the tools.
- It gains a filter box above 6 labels.
- Swatches show each label's own colour: its newest paint, else the model
  colour (`getModelRegions`), else a dashed grey. Before, they showed the
  active brush colour.
- The list re-renders a microtask late. A run sets the labels just before the
  model colours, and `setModelColorRegions` doesn't notify.

**Extras.**
- A "base" chip.
- Natural skin and hair tones in the colour picker, via a new
  `extraSwatches` option. The data lives in `src/color/naturalTones.ts`, so
  the paint layer doesn't import segmentation.

**Measured on the Tsubasa figurine** (460k triangles): 9 parts plus the base
in about 21 actions, versus 31 after #1054:
- 9 chip keys, with "hair" already armed;
- 11 pins, one per part plus a second eye;
- Enter.

There were no specks and nothing left unassigned.
