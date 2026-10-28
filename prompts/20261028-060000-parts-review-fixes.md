---
session: "0124MugS7aLdW18UJDeEAS17"
timestamp: "2026-10-28T06:00:00Z"
tools: [playwright, vitest]
---

## Human

(Same request as the parts commits; this commit acts on a review of the branch.)

## Assistant

Fixes from an independent review of the Parts work (kemper/partwright#1184):

- **Shift gestures and part keys** no longer fire while another tool owns the
  viewport: any docked panel other than Parts (Part Detection's Shift-drag
  selection, Surface pick…) or Measure blocks them, and the keys only act with
  focus on the page, viewport, object list or Parts panel.
- **Apostrophes in part names** ("Bob's arm") broke line parsing; lines are
  now read as JSON first, single quotes only as a fallback. A trailing
  comment with a parenthesis no longer hides a line.
- **Deleting a part with copies** made from it now refuses and names them
  (they'd vanish too) — select them as well to delete together.
- **New names avoid deleted ones**: names in `api.removePart` lines and names
  edit lines create are taken, so a fresh copy, group or imported part can't
  be silently removed.
- **Undo** refuses once the code changed since the edit (it would discard that
  change), reverses a rename's paint re-keys, and keeps its entry when it fails.
- **Ungroup** turns the group's later moves into member moves and refuses
  when a turn/scale/mirror acts on the group as a whole, instead of dropping
  those lines. Grouping says when member paint stops matching.
- **Nudges** save one version (and one undo step) after the keys go idle
  (new Advanced setting), not one per arrow press.
- **API scoping**: `partAction` acts on every part unless `parts` is given;
  the panel passes the selection itself (a UI selection never narrows an API
  call). Rename routing checks op-line names exactly.
- Smaller: SCAD/BREP bake warning when adding an import to such an object,
  save errors surfaced, 44px touch targets for the panel inputs and swatches,
  no Hide/Delete for the unlabeled remainder, quarter-turn-only rotate
  folding, block-comment headers and template literals kept intact by the
  import wrapper, a fresh default group name, and a pill id that clashed with
  Part Detection's.
