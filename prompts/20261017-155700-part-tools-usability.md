---
session: "01VWRRNjTuoikvNpPP1MjXh3"
timestamp: "2026-10-17T15:57:00Z"
tools: [subagent, playwright, vite-node]
---

## Human

After hands-on testing of the part-detection foundation (#1028) on a fused
460k-triangle figurine: "Separate pieces" found only 2 parts; with crease
watershed it wasn't obvious seeds must be clicked, and the seeds were
invisible after clicking; part edges weren't smooth; wanted semi-real-time
settings, a mode that flips through presets so you can stop on a good one, an
"auto seed" where a human only names / merges / refines, and the ability to
focus on one piece without new settings touching the rest. Follow-ups: seed
markers must be hideable to click underneath; real-time must be
disable-able (chose "always manual" by default); build the preset filmstrip;
no AI naming for now, but the chat AI should be able to run auto seed and
hand the panel to the user; asked whether global mesh-refine sliders would
help. Then: merge #1028 and do everything in a single PR.

## Assistant

## Key decisions

**Auto patches = over-segment, then merge by groove strength.** One seed per
grid cell grown with crease-weighted path cost puts patch borders on grooves;
borders are ranked by length-weighted mean crease and unioned below a
threshold. The over-segmentation depends only on (features, cell size,
allowed area) and is cached in the runner, so the Coarser ↔ Finer slider is
instant after the first run (~1.4 s first, 0.1–0.35 s after on the figurine).
Generic names ("patch N") are flagged so they never merge into a real part.

**Lock and focus are one mechanism: an allow-mask.** Detectors take an
optional `allow` mask; the draft merges a masked result back by part name.
Every re-detection now goes into the existing draft as an undoable step
(colours carry over, a preset flip can be undone).

**Smooth edges without a global refine slider.** I recommended against a
mesh-refine slider (it multiplies cost everywhere to fix a boundary-only
problem). Instead each vertex gets a soft top-3 part membership diffused over
the boundary band; triangles whose corners disagree are split along the
equal-membership line. Crossing points are keyed per mesh edge, so the cut is
watertight by construction (verified: manifold status NoError, identical
volume and genus on the figurine). The same cut drives the overlay and the
accept re-mesh, so what you see is what is saved; a re-opened smooth-accepted
import starts with smoothing 0 so it isn't cut twice.

**Preset filmstrip ranks by a heuristic, previews without touching the
draft.** My first score (mean boundary groove strength) put "Very coarse"
first on the figurine: merging only keeps the strongest seams, so strength
alone always rewards merging everything. Replaced with the F1 of groove
coverage (strong-groove length on boundaries) and groove fidelity (boundary
length on strong grooves), discounted by islands and unassigned area; the
figurine now ranks Big blocks / Fine / Balanced first. Cancel is "soft" (stops between presets) so it never tears
down the Worker and the draft with it. Fixed a hover → preview → re-render
→ hover loop by rebuilding tiles only when results change.

**Seeds live in the controller, markers in the scene.** Working seeds are
shared by the panel, the markers and the console (`get/setPartSeeds`), and
sync from the draft only when an edit actually changed the draft's seeds,
so pending (not yet detected) seed edits aren't clobbered. Seeds are placed
on a click (press + release without moving) so dragging still orbits; dots
drag to move, right-click deletes, H hides. Name tags are a constant screen
size and shown once per name — world-sized tags per seed buried the face in
labels when zoomed in.

**Parity.** New console methods (`reopenParts`, `previewPartPresets`,
`showPartPresetPreview`, `applyPartPreset`, `get/setPartSeeds`,
`openPartsPanel`), new edit ops (moveSeed, seedsFromParts, lock, focus,
setEdgeSmoothing), `acceptParts({smoothEdges})`, help entries, AI tools
(detectParts / reopenParts open the panel for hand-off), docs, and three
appConfig knobs exposed in Advanced Settings.
