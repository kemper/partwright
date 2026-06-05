---
date: 2026-06-05
branch: claude/practical-hypatia-ORMxl
files_changed:
  - index.html
  - src/landing/landingEntry.ts
  - tests/landing-static.spec.ts
---

## Human

I want the "New: Voxels, BREP solids & image relief" bubble on the landing page
to be a button to the "What's new" page linked from the top menu. Currently it's
not clickable. In addition, when I click "Try with an AI agent →" the back button
doesn't take me back to that link in the page — I'd like it to. Same thing when
someone clicks "For AI agents" from the top menu: the back button should return
to the top of the page when that link was clicked.

## Assistant

Two changes, plus a regression spec.

**1. New hero bubble → /whats-new.** The bubble was a static decorative `<div>`.
Turned it into an `<a href="/whats-new">` (same pill styling + `text-decoration:
none`), matching where the header's "What's new" link points. It's a plain
hard-navigation link, so Back from the What's-new page returns to the landing
page natively.

**2. Back button after in-page anchor jumps.** Root cause: the landing page
scrolls *inside* `#landing-inline` (`position:fixed; overflow-y:auto`) because
`<body>` is `overflow-hidden` — the document itself never scrolls. Browsers only
restore scroll position on Back/Forward for the *document* scroller, never an
inner container, so a native `#li-agent-section` jump (from "Try with an AI
agent →" or the header's "For AI agents") left `#landing-inline` stuck
scrolled-down on Back.

Fixed by taking over same-page anchor navigation in `landingEntry.ts`
(`initAnchorScroll`): a delegated click handler on `#landing-inline` intercepts
`a[href^="#"]`, pushes a history entry, and smooth-scrolls the target into view;
a `popstate` handler re-syncs the inner scroll to the current URL hash (empty
hash → scroll to top), so Back returns to the top and Forward returns to the
section. Also handles deep links arriving with a hash (e.g. `/#li-agent-section`
from another page's header) by scrolling once on load. Left modified-click /
middle-click untouched so open-in-new-tab still works.

Kept the module's tiny import graph intact (no new imports) per the landing
split contract. Verified in a real browser via a throwaway spec (bubble links +
scroll-down + Back-to-top for both entry points), then folded permanent
assertions into `tests/landing-static.spec.ts`.
