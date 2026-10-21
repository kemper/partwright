---
date: 2026-06-20
task: import selects the new part first with a single render (PR #786)
---

## Liked
- The offscreen-backfill pattern (`executeCodeAsync` with explicit imports +
  `captureThumbnail({rawColors})`) cleanly decoupled "make a thumbnail" from
  "render into the live viewport," which was the crux of every symptom. Once that
  primitive existed, both the new-session and merge paths fell out of it.
- Driving the real import modal in a Playwright spec (file input → "Add parts")
  caught that I'd fixed the wrong code path — the existing `import-merge-url.spec`
  documented that merge is the *default* choice, which reframed the whole bug.

## Lacked
- I shipped a whole PR against the **new-session** path before confirming which
  path the user's repro actually hit. The user's first report literally said
  "the imported part imported with the label Part 1 despite there already being a
  Part 1" — a part-list collision, i.e. merge — and I read past it. A 2-minute
  "which of the two import destinations does this repro use?" check (or just
  reproducing in the browser first) would have saved an entire fix→push→review
  cycle.

## Learned
- `showImportPreview` **pre-selects merge** ("Add as new part(s)") whenever a
  session is open. So "import a thing while I have a starter open" is the merge
  path by default, not new-session. Worth keeping in mind for any future import
  work.
- `selectPart()` **deadlocks** when called from inside the import flow (its
  `cancelCurrentExecution` + `saveVersion` preservation re-enter badly). Filed as
  #789. The general lesson: a UI-event-handler function isn't automatically safe
  to call from another async flow.

## Longed for
- A cheap way to know, from a bug report, which of several near-identical UI
  entry points the user exercised. Two import destinations with near-identical
  symptoms cost a wrong-path fix. A repro-first reflex (reproduce in the browser
  before reading code) is the real fix; tooling can't substitute for it.
