---
session: "01BsPPSVZ2oFGFXTxRyBtu1M"
timestamp: "2026-10-23T19:05:00Z"
tools: [subagent, git-worktree, playwright]
---

## Human

(Relayed review of the #1050 follow-up commit, PR #1071.) Fix eleven findings as one new commit:
- auto-absorb eats user-named or merged parts;
- Enter accepts after another dialog has handled it;
- a plain drag no longer orbits in Select;
- type-to-name steals the tool shortcuts;
- Enter in the rename box merges on a prefix match;
- the ⋯ menu has no keyboard model, and Escape skips it;
- a cancelled pen stroke applies later;
- Shift-drag should stay additive;
- the CLI/bench should use the same auto-absorb setting;
- the fused-figure first click should be a single undo step;
- `centroidCache` should reset with the draft.

## Assistant

## Key decisions

**Auto-absorb only takes unclaimed specks.**
- A region is protected if it has a pin of any kind (automatic pins included), a hand fix, or lies outside the edit's allow-mask.
- It is also protected if its part is locked, user-coloured or user-named.
- "User-named" is tracked explicitly. A new `placeholderNames` set holds the names a seedless detector or the fallback made up ("patch 3", "part 2").
- `rename` and a named `merge` remove a name from that set. The set lives in snapshots, so undo restores it, and in clones.
- A pattern on the name text was rejected because users type names like "arm 2".
- A fresh detection is the one place automatic pins are not claims: `absorbSpecksNow` drops them for the pass, and `syncAnchors` puts them back.
- The CLI and `segment:bench` (`segmentMesh`) now pass the same `autoAbsorbSpeckFrac`, so headless runs match the browser.

**Select brush: grab your part and paint more of it.**
- A drag brushes only when it starts on a part that is already selected. Every other drag orbits again.
- Alt-drag follows the same rule.
- Shift-drag paint-select adds to the selection again, as it did before #1050.

**Shortcut letters stay shortcuts.**
- V, P, B, S, H, M and R never start a typed name.
- Other letters open the rename box pre-filled with that letter. R opens it empty.
- The hint and the `?` sheet say that names starting with a shortcut letter go through R.

**Enter in the rename box takes the exact typed text.**
- A suggestion is used only when picked with the arrows, Tab or a click, or when it matches the text case-insensitively.
- The highlight shows which one Enter will use.

**Panel-level Enter defers.** It bails when the event was already handled (`defaultPrevented`), and acts only when the target is the page body or the canvas.

**⋯ menu keyboard model.** Like the command palette: the arrows, Home and End move focus, Enter activates, and Escape returns to ⋯. The panel's capture-phase Escape handler now yields while a popover or menu is open.

**Cancelled gestures apply nothing.** A window `pointercancel` handler drops the brush, the paint-select, the Fix stroke and any pin drag. It clears the ghost and puts a dragged pin back.

**Fused-figure first click is one step.** The "clear the Pieces draft" and "add the pin" ops go in one batch, so a single Undo brings back both pieces, base included. The banner says "cleared the Separate pieces parts and placed your pin".
