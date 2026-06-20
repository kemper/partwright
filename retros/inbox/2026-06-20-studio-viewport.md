---
date: 2026-06-20
task: studio-space interactive viewport — graded backdrop + PBR lighting + contact shadow (PR #793, tracking #792)
---

## Liked
- Three parallel `explore` agents (render/style, interaction model, transform ops)
  returned a complete, file:line-grounded picture of the viewport in one round —
  enough to give an opinionated recommendation without the main context filling
  with file dumps.
- Prototyping 3 switchable looks behind a temporary `?studio=N` gate and shipping
  side-by-side contact sheets (sharp montage) let the user pick the direction in
  ONE round instead of iterating one interpretation blind. This is exactly the
  "prototype + demo + pick" norm CLAUDE.md prescribes for subjective work, and it
  paid off — the chosen look needed zero rework.

## Lacked
- No Playwright MCP, so every visual check is a spec round-trip (~1 min/run with
  WASM warmup). Each tweak (tour overlay, camera dolly, theme toggle) cost a full
  re-run. A tiny "load route + run code string + screenshot" helper that takes a
  model file + URL params would have collapsed 3 iterations into config changes.
- Hit the onboarding-tour auto-overlay polluting screenshots; had to discover the
  `partwright-tour-completed` localStorage key. `npm run snap` (the look-only
  helper) doesn't run code or suppress the tour — a `--no-tour` / `--run <file>`
  flag would make it usable for "screenshot this example in this look."

## Learned
- The `model is always one merged THREE.Mesh; "parts" are code-level` fact is the
  single most important constraint for any "select/manipulate an object" feature —
  worth surfacing in CLAUDE.md's viewport section so the next agent doesn't
  re-derive it (three sessions' worth of the main.ts NUL-byte note suggests this
  pays off).

## Longed for
- A documented way to drive the live viewport for screenshots without writing a
  throwaway spec each time (tour-suppressed, code-loaded, param-aware). The
  manual-verification loop is the slowest part of any UI change here.
