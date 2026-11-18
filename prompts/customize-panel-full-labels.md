---
date: 2026-11-18
branch: claude/determined-newton-w7qx00
files_changed:
  - src/ui/paramsPanel.ts
---

## Human

In the Customize (parameters) panel, labels/descriptions are often cut off
("Tier 1: count (custom mo…"). Wants something better: at minimum on-hover,
but ideally show the full description and/or resize the panel to fit its
contents.

## Assistant

- Did all three: labels wrap instead of `truncate`, the param's `help`
  text is shown under its label, and the hover title carries label + help.
- Panel width is now content-sized (`w-max`, 15rem floor, 24rem cap) so short
  schemas stay compact and long labels get room before wrapping; max height
  raised (60vh/22rem → 70vh/34rem) so more knobs fit before scrolling.
- Change is in the shared `buildWidget`, so the Assembly shared-params panel
  gets the wrapping/help too (its fixed w-64 is unchanged).
