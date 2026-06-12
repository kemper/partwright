---
date: "2026-06-11T13:10:00Z"
task: "feat: consolidate the chat AI's texture tools into auto-routing applySurfaceTexture (PR #590)"
areas: [ai-tools, geometry-api, docs, verification]
cost: low
---

## Liked / Worked
- **The user's question ("are the AI tools aligned?") was answerable in three
  greps** because the tool layer is one file with explicit gating sets — and
  the answer (no: 8 always-bake tools, zero api.surface mentions, one false
  "stays editable" claim) was crisp enough to drive a real product decision.
- **AskUserQuestion at the genuine fork** (remove-vs-auto-route-vs-re-steer)
  rather than guessing: the user's instinct (remove) and the better shape
  (consolidate + auto-route) differed in one capability (SCAD/BREP texturing
  from chat) that was worth surfacing before building.
- **The placeModel `mode: 'auto'` idiom generalized perfectly** — routing in a
  console twin keeps tools.ts a thin schema layer and gives external agents
  the identical behavior for free.

## Lacked
- **A "tool-layer parity" check.** The drift this PR fixed (UI moved to
  non-destructive paths; the AI tool layer kept teaching the destructive
  loop) sat unnoticed across two merged PRs until a human asked. The CLAUDE.md
  parity rule covers window.partwright + help() + ai.md + tools.ts in the
  same PR — but nothing audits EXISTING tools when a path's preferred
  semantics change. A periodic "does any tool description contradict the
  current preferred path" pass (work-reviewer prompt line, or a retro-review
  agenda item) would have caught it.

## Learned
- **Tool descriptions are the real steering surface for the in-app AI** —
  subdocs are read on demand, but schemas ride every request. Alignment work
  that only touches docs (ai.md/textures.md) doesn't change model behavior.
- **`engineBakeWarning` deliberately stays silent for voxel→manifold-js**
  (only SCAD/BREP lose a parametric source worth warning about) — a test
  asserting a warning on the voxel fallback path is wrong by design.

## Longed for
- A **schema-size budget readout** in CI or the diagnostics modal: this PR
  collapsed ~8 large schemas into one, but nobody measures the tool-list
  token cost per provider call; a printed number would make future tool
  additions accountable the way bundle-size checks do.
