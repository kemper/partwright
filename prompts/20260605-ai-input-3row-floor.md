---
session: "happy-einstein"
timestamp: "2026-06-05T00:00:00Z"
model: claude-opus-4-8
tools: [explore, Bash, Edit, Write]
---

## Human

I've had some situation where the AI pane text box gets squished and it's hard
to read or type into. I never want it to have a height less than maybe 3 rows
of text.

## Assistant

## Key decisions

**Root cause.** The AI drawer's textarea (`src/ui/aiPanel.ts`) had `min-h-0`
and lived inside `bottomSection`, a *fixed* 220px box with `overflow-hidden`.
The textarea was `flex-1`, so it only got whatever height the fixed budget had
left after its `shrink-0` siblings (toggle strip, cost meter, pending-images
row, in-progress indicator, queued-message badge). When several of those rows
appeared at once — or the toggle strip wrapped — they ate the 220px and the
`min-h-0` textarea collapsed toward 0px. There was no programmatic floor.

**Fix — a real 3-row floor that's actually honored, not clipped.**
- Textarea: dropped `min-h-0`, kept `flex-1` (still grows to fill the pane),
  and added `style.minHeight = '74px'` ≈ 3 rows of `text-sm` (20px
  line-height) + `py-1.5` padding + border. Bumped `rows` 2 → 3 as the
  non-flex fallback.
- `bottomSection`: switched from a fixed `height` to `minHeight` and removed
  `overflow-hidden`, so when sibling rows appear the whole section *grows* to
  preserve the textarea floor instead of clipping it. The section is `shrink-0`
  in the panel column, so growth pushes the transcript (which scrolls) rather
  than squishing the input.
- Resizer (`initInputResizer`): now sets `style.minHeight` to match, so the
  drag-handle's 100–520px range still works with the growable model.

**Verification.** `npm run build` (type-check) clean. A throwaway Playwright
spec opened the panel, force-revealed every space-claiming sibling row at once,
and measured the textarea: baseline 87px, worst-case 74px — the floor holds
where it previously collapsed. Scratch spec/screenshots deleted before commit.
