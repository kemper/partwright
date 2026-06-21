---
date: 2026-06-14
branch: claude/bucket-fill-reconcile-test-fj6b9b
files_changed:
  - tests/paint-controls-extended.spec.ts
---

## Human

CI flake: `tests/paint-controls-extended.spec.ts:311` — "color bucket fill over a
brush-painted blob commits and survives reconcile" — failed once (expected 2
regions, got 1) and passed on retry (reported flaky). Investigate and fix.

## Assistant

Reproduced the flake locally with `--repeat-each` (~2/8 runs failed). The visible
symptom varied — sometimes `afterBucket.length === 1`, sometimes
`afterBrush.length === 0` — but both are the *same* root cause: a mouse-driven
paint stroke never committed a region.

**Root cause — the first-run guided tour backdrop swallowed the real mouse
events.** `src/ui/tour.ts` fires `setTimeout(() => startTour(), 800)` on a fresh
`/editor` visit (no tour-completion flag, no suppressing query param) and mounts a
full-screen `.tour-backdrop`. The test drives the brush/bucket with **real**
`page.mouse.down/move/up`, which go through the browser's hit-testing, so once the
backdrop is up the pointerdown lands on it — not the canvas — and
`paintMode.onPointerDown` bails at `event.target !== renderer.domElement` (no
stroke, no region). The test's only defense was a best-effort `Skip` click guarded
by `if (await skip.count())`, evaluated immediately after `run()` — a race: when
the button hadn't rendered yet the click was skipped and the backdrop later ate
the paint events. This is exactly the hazard the file header already flags ("Uses
dispatchEvent('click') … to dodge the onboarding tour backdrop") but the
mouse-driven flow can't use dispatchEvent.

**Fix (deterministic, no production change):**
1. In the shared `openEditor` helper, `page.addInitScript` sets
   `localStorage['partwright-tour-completed']` before any page script runs, so
   `maybeStartTour()` returns early and the backdrop never appears. Synthetic
   `page.mouse` events now always reach the viewport.
2. Replaced the two fragile `waitForTimeout(700)` settles in the bucket-fill test
   with `await partwright.waitForPaint()` (the existing test-facing paint-idle
   promise), so the assertions read region state only after the async
   worker-backed reconcile has actually landed — not after a fixed timeout that
   can expire mid-reconcile on a loaded CI shard.

Verified: the target test passes 12/12 under `--repeat-each=12` (was ~2/8
failing), and the full `paint-controls-extended.spec.ts` file passes 13/13.
Typecheck + unit tier green.

Note: the CI run's hard failure was a *different* test
(`keyboard-shortcuts.spec.ts:72`), which drives paint programmatically
(`paintFaces` + `dispatchEvent`/`focus`, no real mouse events) so it's unaffected
by the tour backdrop. It passed 6/6 locally; it looks like a separate, low-rate
flake outside this branch's named scope — flagged in the PR rather than chased
here.
