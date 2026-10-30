---
date: "2026-10-28T03:55:00Z"
task: "feat: parts multi-select, Parts panel, arrange/copy/group as code, import into any object"
pr: 1184
areas: [ui, import-export, agents, testing, git-workflow]
cost: medium
---

## Liked / Worked
- Keeping the math pure (`partOps.ts`, `partLayout.ts`, `partOpCode.ts`,
  `composeIntoCode.ts`) let ~80 unit tests pin the tricky bits (op-line
  folding, ungroup, name reservation) before any browser run.
- An independent `work-reviewer` pass over the full diff found four real
  blocking bugs (Shift gestures stolen from Part Detection, apostrophes in
  names, deleting a part silently deleting its copies, reused deleted names)
  that my own targeted e2e runs had not exercised.

## Lacked
- Two DOM ids collided silently (`parts-viewport-toggle` was already Part
  Detection's Tools pill); only a CI e2e shard caught it. (cost: one CI cycle)
- A document-level keydown handler is easy to get too broad: Backspace on any
  focused button deleted parts until the review caught it.

## Learned
- `getActiveViewportPanel()` is the cheapest "is a tool owning the viewport"
  test; a capture-phase pointer listener on the canvas container pre-empts
  the viewport's own `pointerSuppressors`, so it must check it.
- An earlier PR's merged branch name blocks a force-push restart; merging
  `origin/main` (which already contains the old tip) makes the push a plain
  fast-forward.

## Longed for
- A lint rule (ast-grep) flagging duplicate literal `id = '…'` / `getElementById('…')`
  strings across `src/ui/*` — the pill-id clash is exactly that shape.
- A shared "global shortcut" helper that already encodes the scope rules
  (editable targets, CodeMirror, modals, other tools, focus in the right pane),
  so new keyboard handlers can't forget one.
