---
session: "DDouT"
timestamp: "2026-06-04T01:55:00Z"
model: claude-opus-4-8
tools: [subagent, playwright]
---

## Human

I'm about to release to production. I'd like to have 4 to 6 subagents review
all the recent work done since the last release and see if it is all correct
and cohesive. Find bugs, mismatches with patterns, incomplete work, and other
cleanup that should happen before the production release. [After the review:]
Fix the blocker + all SHOULD-FIX items.

## Assistant

## Key decisions

**Review scope.** The release candidate is `origin/production..origin/main`
(165 commits; `main` == `staging`). Sliced it into six cohesive themes and ran
one read-only subagent per slice, each diffing that range for its paths (the
built-in work-reviewer diffs against `origin/main`, which is HEAD here, so it
would have seen nothing — gave the agents an explicit range instead). Verified
the two highest-impact findings myself before trusting them.

**Why these eight fixes.** One true blocker plus the SHOULD-FIX set:

- **Plan-first approve ran with no tools (blocker).** `approvePlan` passed
  `settings.toggles` verbatim, but `planFirst` is never cleared on approval, so
  `buildToolList` returned `[]` and the plan-mode "do NOT call any tools" suffix
  was emitted — the approved turn could only re-plan, never build. Forced
  `planFirst:false` only for that one turn rather than mutating saved settings,
  so the user's pill state is untouched.
- **Refinement turn could lose plan enforcement.** The pending-approval state,
  not the live pill, is the source of truth while a plan is pending — forced
  `planFirst:true` on the refinement toggles so toggling the pill off mid-pending
  can't leak tools.
- **Bucket color-fill stored refined-mesh ids as base ids.** Mirrored the brush
  path's `triangleToBase` remap; `resolveDescriptorTriangles` re-resolves
  `kind:'triangles'` by base→child remap on every rebuild, so refined-space ids
  would smear the fill after a subdivide.
- **SCAD `$fn` rewrite distorted low-poly shapes.** Changed the unconditional
  rewrite to `min(sourceFn, preset)` in both the preview and full passes: still
  caps expensive high `$fn` to the quality preset, but never *raises* a
  deliberately low `$fn` (e.g. `$fn=6` for a hex bolt), which is a shape choice,
  not a quality knob. Verified visually — a `$fn=6` cylinder stays a 20-triangle
  hex prism at HIGH quality instead of smoothing to a round cylinder.
- **Companion modal basename collision.** Replaced `sameInclude`'s bare-basename
  match with a trailing-path-segment match, so `a/foo.scad` and `b/foo.scad`
  stay distinct while a probe's resolved absolute path still matches its
  as-written include.
- **Resize preview didn't revert to identity** and **hardcoded its debounce.**
  The identity branch now calls `clearPreview()` (was only clearing status), and
  the debounce reads `getConfig().ui.surfacePreviewDebounceMs` per the
  no-hardcoded-constants rule, reusing the sibling Surface panel's knob.
- **Drag listener leak on rebuilt panels.** `attachViewportPanelDrag` now returns
  a `destroy()` that removes its `window` resize listener; Surface and Resize
  (which build a fresh panel every open) call it from `close()`. Singletons can
  ignore it.

**Verification.** `npm run build` (tsc), `npm run test:unit` (598/598), and the
targeted e2e specs (scad-companion, quality-scad, paint-controls-extended) all
green; plus an eyes-on screenshot of the hex-prism case.
