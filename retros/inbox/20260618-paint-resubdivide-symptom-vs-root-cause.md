# Retro — paint refine modal: symptom-fix vs root cause

## Liked
- The user's own workaround ("undo + smooth off = instant, the button alone didn't")
  was the decisive clue. Taking it literally — *what does undo do that the button
  doesn't?* — pointed straight at "undo removes the stroke; the stroke is what forces
  refinement," i.e. the root cause, not the button.
- The existing live-vs-reload **determinism** e2e specs (paint-smooth-brush) gave high
  confidence that a new reconcile fast path matched a full rebuild — I could change
  the hot path and trust those as the correctness guard.

## Lacked
- The first PR shipped a button that *named* a remedy ("turn off smoothing → faster")
  without verifying the remedy actually worked end-to-end. A smooth stroke is a
  permanent `brushStroke` descriptor that `descriptorRefines()` forces true forever,
  so turning the toggle off changed nothing for existing strokes. Lesson: when a UI
  affordance promises a performance outcome, exercise the *promised outcome* in the
  browser (paint → toggle → paint again), not just the toggle's state change.
- `pendingStrokeRegionId` was set only on the agent paint path, so UI-stroke cancels
  silently left dead refine-forcing orphans. A grep for "who sets this, on which
  paths" would have caught the asymmetry earlier.

## Learned
- In the paint reconcile, "is this a refine descriptor?" is the load-bearing
  predicate. `brushStroke` ⇒ always refines; the reconcile only had a cheap path for
  *appending a new* brushStroke, so any other change with a brushStroke present fell
  into a full worker re-subdivision. The fix was a fast path keyed on "refine set
  unchanged" (+ mesh-identity guard against external mesh swaps).

## Longed for
- A cheap instrument for "did painting trigger the subdivision worker?" In the test I
  had to install a MutationObserver on the progress modal to prove a *negative* (no
  re-subdivision). A counter on the worker dispatch (exposed via workerStats) would
  make "this action stayed on the fast path" a one-line assertion.
