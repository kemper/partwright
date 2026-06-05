---
session: "exbellnkv"
timestamp: "2026-06-05T23:18:20Z"
model: claude-opus-4-8
tools: [explore, playwright]
sequence: 3
---

## Human

I used an enhance mesh value way too large and couldn't click cancel. I
eventually got a warning that the model was over 10 million triangles. Then I
got multiple browser popups asking if I should wait for the page or kill the
tab. I'd like this calculation to happen in wasm or a web worker, whatever
makes the most sense. Just so long as we don't hang the main thread. But also,
we should probably warn people when they click apply and the triangle count is
over whatever our current warn limit is and have them click proceed or cancel.
Also, once I did apply the "reset" button is still enabled which no longer does
anything. If it can only reset before the apply, it should be disabled until a
change has happened and then become enabled, but disabled again right after
apply is clicked.

## Assistant

## Key decisions

Investigated first (explore agent over the worker path). Findings that shaped
the fix:
- The refine compute **already runs in the geometry Web Worker** — the freeze
  was NOT the search. The direct edge-length enhance (`refineToEdgeLength`) is
  **uncapped**: a tiny edge length produces a 10M+ triangle mesh, and the
  **main-thread commit** of that result (`Manifold.ofMesh` + a 10M-iteration
  `meshGLToBufferGeometry` + `computeVertexNormals`) is what froze the page and
  blocked the Cancel button. The "10M" warning the user recalled doesn't exist;
  the only threshold was a hardcoded `HIGH_COMPLEXITY_TRIANGLES = 1_000_000`.

So moving the calc to a worker wasn't the real fix (it's already there). The fix
is to **never hand a giant mesh to the main thread**, plus a pre-apply confirm.

**Issue 1 + 2 — don't freeze; warn before applying (two layers):**
1. **Pre-apply guard (front line, `simplifyUI.runApply`).** Before an enhance
   runs, project the triangle count — exact for the count knob, estimated for
   edge length via a new pure `estimateRefineTriangles` (Σ k² over triangles,
   k = ceil(longestEdge/length)). Over `enhanceMaxTriangles` → refuse outright
   (toast, never runs). Over `enhanceWarnTriangles` → a Proceed/Cancel modal
   (`heavyMeshConfirmModal.ts`, mirrors `exportConfirmModal`). Only enhance is
   gated; simplify only reduces.
2. **Worker hard cap (backstop, `simplify.refineToEdgeLength` +
   `enhanceToTriangleBudget`).** After the WASM refine, if the result exceeds
   the cap, the Worker discards it and returns `{ exceeded, triangleCount }`
   with **no mesh** — so even when the estimate undershoots, the giant mesh
   never reaches the main thread. The cap is read on the main thread (where
   getConfig sees the user override) and threaded through the `enhance` message,
   since the Worker's own getConfig only sees static defaults.

   Thresholds are new `renderer.enhanceWarnTriangles` (1M) /
   `enhanceMaxTriangles` (5M) config fields (not hardcoded), exposed in Advanced
   Settings.

**Issue 3 — Reset enable/disable.** Reset now mirrors Apply: `updateApplyEnabled`
disables both when nothing is pending, so Reset is idle on open, enables when a
quality preview or simplify/enhance target is set, and goes disabled again the
instant Apply commits (appliedKey updates, quality becomes committed).

**Tests.** New unit test for `estimateRefineTriangles`; e2e tests for the
Proceed/Cancel confirm (cancel leaves the mesh, proceed grows it) and the
hard-cap refusal; tightened the Reset test to assert the disabled→enabled→
disabled lifecycle. All on the existing PR #456 branch (these are follow-ups to
that unmerged feature).
