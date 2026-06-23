---
session: "idpiob"
timestamp: "2026-06-11T21:45:00Z"
model: claude-opus-4-8
sequence: 4
---

## Human

PR #600 conflicted again: main's #601 (hand grip-frame API) rebuilt the rocker
guitar a second time. Update to latest main.

## Assistant

## Key decisions

Merged origin/main. #601 only ADDED API (`GripFrame`, `rig.grip`, `holdAt`) and
rebuilt `examples/figure_rocker.js` to seat the guitar via the new grip frame —
it did NOT change default hand/grip geometry, so the other 9 figure bakes stay
correct and were left untouched. Only `rocker.partwright.json` conflicted; took
main's example source and re-baked rocker from it. Clean: manifold,
componentCount 1, genus 2, all 11 labels resolved; thumbnail shows the single
guitar seated in the hands.
