---
session: "01BsPPSVZ2oFGFXTxRyBtu1M"
timestamp: "2026-10-17T15:30:18Z"
tools: [subagent, playwright]
---

## Human

After the part-detection foundation (#1025) merged, asked me to implement the
tracking issue's "Import integration" deliverable: "Detect parts" on STL
import (auto-propose, open the panel) plus palette and Paint-panel entry
points.

## Assistant

## Key decisions

**Adaptive post-import step, not a second prompt.** Detect-parts and the
existing convert-to-code ask are both viewport panels and mutually exclusive,
so after an interactive manifold STL import the automatic detectors run first
(new `segmentation.autoDetectOnImport`, on by default). If they split the
mesh, the Detect parts panel opens on the proposal with "Convert to code
instead"; otherwise the convert ask opens as before, with a "Detect parts…"
button. Either path stays one click, and single-solid imports (most CAD
parts) keep the old flow. Console imports (`importMeshData`) stay prompt-free.

**Registry-driven auto-propose.** Added an optional `autoPropose: {priority}`
to `PartDetector`; `pieces` opts in at priority 0. The controller's new
`autoDetectParts` tries opted-in seedless detectors cheapest-first and keeps
the first result with 2+ parts as the draft; a one-part result leaves no
draft (it is noise) and returns a reason pointing at seeded detection. A
future seedless detector for fused shells (the `auto-merge` duel) only has
to opt in to be used on import, with no import-flow change.

**Parity.** `autoDetectParts` is a window.partwright method (help() entry),
an AI tool (PARTS_GATED), and documented in ai.md + /ai/segmentation.md
(including that an interactive import may already have left a draft).

**Paint entry via a registered hook.** `setDetectPartsEntry` in paintUI lets
the part-detection UI register the Labels-section button, so the paint layer
never imports segmentation. Shown only when the model is an import. The
palette entry and viewport Parts button already existed.

**Measured on the 460k-triangle Tsubasa scan** (figure + base disc = 2
pieces): auto-detect adds ~1.2 s to import (18.5 s vs 19.7 s to the next
prompt), and the feature analysis it computes is cached for the seeded run
that follows. Kept the scope to the deliverable; the owner's follow-up plan
items (seed markers, Lock/Focus, the one-solid hint inside the panel, live
mode) are left to their PRs.

## Human (follow-up)

(Review pass from the work-reviewer subagent on the draft PR.)

## Assistant

**Review fixes.** The import no longer waits on detection (fire-and-forget +
a "Looking for separate parts…" toast; triangle budget
`autoDetectMaxTriangles`, part cap `autoDetectMaxParts` for debris /
assemblies). Trials are now previews, so a pass that proposes nothing leaves
an existing draft alone (no discard race with a user's Detect). Errors other
than cancel are logged and fall back to the convert ask; cancel stays quiet.
Guarded the null draft after `refreshOverlay` (also in `detectParts`).
Closing an untouched import proposal discards it so no orphan overlay
remains. Shared button styles + mobile touch targets; the Paint entry skips
relief imports; the method dropdown follows draft changes.
