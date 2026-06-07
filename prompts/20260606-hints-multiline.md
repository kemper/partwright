---
date: 2026-06-06
branch: claude/awesome-lamport-MnWRP
files_changed:
  - src/ui/hints/hintsTicker.ts
---

## Human

When the AI pane is open the hint box shows messages with an ellipsis. Can we
make it where if the AI pane is open (or otherwise the horizontal space is
cramped) that we multiline it and expand it vertically? On mobile when it's very
small we should probably just not bother showing it.

## Assistant

The "Did you know?" hints strip lives in the toolbar's flex-1 middle host
(`src/ui/hints/hintsTicker.ts`). Its text span carried Tailwind `truncate`
(`white-space: nowrap; overflow: hidden; text-overflow: ellipsis`), so whenever
the AI panel opened — which shrinks the toolbar middle, since the panel is a real
flex column eating layout width — the hint collapsed to one ellipsised line.

Two changes:

- **Wrap instead of truncate.** Swapped `truncate` for
  `break-words line-clamp-3` on the text span. Natural wrapping means the hint
  stays on one line when there's room and only expands vertically when cramped
  (AI panel open or a narrow window) — which is exactly the "if cramped, go
  multiline" ask, with no need to explicitly watch the panel toggle since the
  existing `ResizeObserver` on the host already reacts to the width change.
  `line-clamp-3` caps growth at three lines so a very long hint on a very narrow
  strip can't balloon the toolbar; the flex siblings (icon, badge, CTA, ‹›✕
  controls) stay vertically centered via the strip's `items-center`.
- **Hide on mobile.** The strip previously only hid below a 200px host width,
  which doesn't reliably trigger on mobile (the wrapped toolbar can still give
  the host a wide row). Added a `matchMedia('(min-width: 768px)')` gate to the
  `applyWidth` check so the strip is hidden outright below the app's md
  breakpoint — the toolbar is already cramped and wrapping on phones, so the
  discovery strip isn't worth the space there. Re-evaluated on breakpoint
  `change` too (a window resize across 768px may not shift the host's own width
  enough to trip the ResizeObserver) and cleaned the listener up in
  `teardownStrip` alongside the existing observer disconnect.

Used the md (768px) convention the rest of the app uses (`layout.ts`,
`aiPanel.ts`) for "mobile" rather than inventing a new cutoff.

Verified with a throwaway Playwright probe at three viewports: AI closed/wide →
visible, single line; AI open (host ~388px) → wraps to multiple lines, strip
grows vertically; mobile (390px) → strip hidden. `npm run build` and
`npm run test:unit` (718) green.
