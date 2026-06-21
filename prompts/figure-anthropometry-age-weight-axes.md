---
date: 2026-06-13
branch: claude/vibrant-hopper-j3xpuf
files_changed:
  - src/geometry/sdfFigure.ts
  - scripts/mine-makehuman-anthropometry.mjs
  - tests/unit/sdfFigure.test.ts
  - public/ai/figure.md
---

## Human

"let's start issue 617" — mine real MakeHuman CC0 deltas for the figure rig's
sex/proportion ratios, and add continuous `age` and `weight` axes. (Mid-task
the user chose, via AskUserQuestion, the "deeper MakeHuman mine" over a
published-anthropometry hybrid.)

## Assistant

Built `scripts/mine-makehuman-anthropometry.mjs`: downloads MakeHuman's CC0
`base.obj` + macrodetail (and breast) morph targets, applies the vertex deltas,
and measures torso cross-section circumference at shoulder/chest/waist/hip
landmarks (heights taken from the mesh's own joint-helper groups, recomputed
per morph so stature changes don't misplace the band; hanging arms excluded via
an armpit-gap cut). Normalizes every ratio to the young/average/neutral point
= 1.0.

Key finding (the reason this was "research-heavy"): MakeHuman's `*-averageweight`
corners are EMPTY (average = the base-mesh midpoint), so **weight** and **age**
mine cleanly off the min/max corners, but the **macro gender** delta is <1% —
MakeHuman's gendered look comes from its muscle/proportion sliders, not gender
alone. The one strong CC0 sex signal is the female-only breast target. Reported
this back; the chosen synthesis:
- **age + weight axes**: continuous, mined from MakeHuman CC0 (anchor tables
  interpolated by years / 0..1), the real new capability. Weight also adds
  torso DEPTH so a heavy figure reads as 3D bulk.
- **sex**: anthropometry-informed stylized breadth (a literal <1% replacement
  would make male/female figures indistinguishable, defeating the option), with
  the mined breast signal reflected in the female chest.

Implementation: a module-level `anthroGirth(sex, age, weight)` composing three
per-region multiplier tables; defaults (neutral/25/0.5) yield 1.0 so the
`headsTall:6` neutral calibration anchor is byte-identical (pinned by the
existing + new unit tests). No catalog figure uses `sex:`, so nothing needed
rebaking. Documented provenance + CC0 attribution in figure.md and the script
header. Verified plausible silhouettes headlessly (lean→heavy widens the
midsection; male V-taper vs female hourglass+bust; elderly fuller waist).
