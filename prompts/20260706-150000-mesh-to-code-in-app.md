---
date: 2026-07-06
branch: claude/serene-ritchie-jfdhv6
files_changed:
  - src/reconstruct/slice2d.ts
  - src/reconstruct/sampleMesh.ts
  - src/reconstruct/meshDistance.ts
  - src/reconstruct/meshComponents.ts
  - src/reconstruct/sectionCode.ts
  - src/reconstruct/reconstructWorker.ts
  - src/reconstruct/reconstructClient.ts
  - src/main.ts
  - src/ai/tools.ts
  - src/ai/slashCommands.ts
  - src/ai/reconstructPrompt.ts
  - src/ui/aiPanel.ts
  - src/ui/advancedSettingsModal.tsx
  - src/config/appConfig.ts
  - src/diagnostics/errorLog.ts
  - public/ai.md
  - public/ai/reconstruction.md
  - tests/unit/reconstruct.test.ts
  - tests/unit/slashCommands.test.ts
  - tests/reconstruct.spec.ts
  - CLAUDE.md
---

## Human

Build a "model to code" feature into the app — both a non-AI version and an
AI-enhanced version. Unsure whether the AI-enhanced UI should reuse the AI
pane or needs something bespoke; wants it to function in a timeframe a user
would actually tolerate. "Build both capabilities in whatever way you think
is best and I'll test afterwards." (Follows the inverse-CAD framework work in
#878/#879; tracked as #897.)

## Assistant

**Two tiers sharing one kernel.** The headless framework's key insight is
that the Benchy converged via a *mechanical* recipe (section-slice →
levelSet interpolation), not agent cleverness — so the non-AI tier is that
recipe ported to the browser (`src/reconstruct/`, straight from
`scripts/inverse-cad/{slice,sampleMesh,distance,mesh,genLevelSet}.mjs`),
and the AI tier is judgment layered on top of the same tools rather than a
separate pipeline.

**Reused the AI pane for the AI-enhanced tier** (the user's open question):
the pane already owns providers, keys, streaming, tool dispatch, and notes,
and reconstruction is exactly its shape — AI iterates code against a
verifier. `/reconstruct` prefills a workflow prompt (mirroring `/portrait`);
`convertToCode` + `evalAgainstImport` became AI tools; the tactics live in a
`reconstruction` subdoc so the prompt stays short.

**In-app adaptations of the generator:** multi-component meshes are split
(weld+BFS) and converted per component with tight bounds, then composed;
debris specks are dropped (the dummy13 lesson); resolution auto-scales from
the mesh bbox against a levelSet *cell budget* (the app has no fixed unit),
so quality presets cost roughly the same regardless of model size. Measured
on a 150k-tri organic model: draft 8s / standard 26s / fine 100s, with
chamfer below the metric noise floor even at draft — the presets buy visual
smoothness, not measurable fidelity.

**Other decisions:** `convertToCode` is manifold-js-only (explicit error for
SCAD/BREP/voxel rather than a silent engine switch); generated code is
self-contained (no `api.imports` refs) so it re-renders without the import;
eval reports carry `sampleSpacing` as an explicit noise floor so agents
don't chase phantom error; the sampled (not exact-BVH) distance metric was
chosen for speed and its noise floor is surfaced rather than hidden. Worker
mirrors the engrave client's terminate-on-abort idioms. Full UI↔API parity:
console API + help() + palette command + AI tools + ai.md + subdoc in one PR.
