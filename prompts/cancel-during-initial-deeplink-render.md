---
date: 2026-06-19
branch: claude/bold-knuth-fhd0b9
files_changed:
  - src/main.ts
  - tests/render-cancel-deeplink.spec.ts
---

## Human

When opening a figure from the catalog, the recently-merged fast-preview feature
shows the rough render plus the "Rendering…" message with a Cancel button — which
I like. But clicking Cancel doesn't actually cancel the more complete, detailed
render. Investigate, create a fix, and open a PR. Use the latest main.

## Assistant

Reproduced with a throwaway Playwright spec on `/editor?catalog=archer.partwright.json`
(an SDF figure): the Cancel button appears at ~0.7s, but clicking it left the status
ticking "Rendering… Xs" all the way to "Ready" at ~23s — the full render completed
regardless. Instrumenting the click handler showed it never fired at all, even on a
direct DOM `el.click()` with the button confirmed as the topmost element and only one
in the DOM.

Root cause is an ordering bug, *not* anything in the progressive-render feature
itself. `main()` runs `await syncEditorFromURL()` partway through its setup, and the
catalog deep-link path inside it `await`s the entire initial render
(`loadCatalogFileIntoEditor → importSessionPayload → loadVersionIntoEditor →
runCodeSync`). The `cancelInlineBtn` click handler was attached *much later* in
`main()` — so during the first render of a deep-linked model, the button was visible
(the run timer un-hid it) but had no listener yet. This affects any slow deep-linked
load (`?session=`, `?idea=`, `?catalog=`), but it's most visible on catalog SDF
figures because the new fast-preview path surfaces the Cancel button prominently for
tens of seconds.

Fix: attach the Cancel handler early — right after the layout is built and the
fast-preview pill is set up, before `await syncEditorFromURL()`. The handler closes
over `surfaceCarveCancel` (a surface-carve abort hook assigned far below in
`buildSurfaceModifierProgress`), so I hoisted that `let` (and its sibling
`surfaceCarveAbort`) to the early site to avoid a temporal-dead-zone read if Cancel
is clicked during the first render; the original block now only assigns them. The
handler body is byte-for-byte the same (carve cancel → surface-compute cancel →
`cancelCurrentExecution`), so later-render behavior is unchanged.

Verified the same repro now flips to "Cancelled" within ~0.5s and stays there (full
render never lands). Added `tests/render-cancel-deeplink.spec.ts` as a regression
guard. `npm run build` + `npm run test:unit` (1500) green.
