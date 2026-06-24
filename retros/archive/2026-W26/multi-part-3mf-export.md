---
date: 2026-06-14
task: multi-part 3MF export with per-plate Bambu layout + filament colours (PR #681)
---

## Liked
- The deep-research fan-out (one subagent per format question — ZIP layout,
  plate mapping, coordinate transforms, color/filament binding, paint_color
  encoding, version markers) reading the actual OrcaSlicer/Bambu `bbs_3mf.cpp`
  source paid off hugely: every format decision was source-grounded, and the
  reports flagged the load-bearing gotchas (the `BambuStudio-` Application marker;
  plate `.json`/`.png` being optional post-slice artifacts) before I wrote a line.
- `model:preview`-style "validate the risky thing first" worked: encoding the
  proprietary `paint_color` bitstream + round-trip unit test up front confirmed my
  derivation against the documented worked values before building on it.

## Lacked
- No way to validate the proprietary Bambu `paint_color`/plate output against a
  real Bambu Studio install in this environment — the highest-risk part ships
  unverified beyond a generic-3MF/round-trip check, pushed to the user's printer.
  A headless 3MF→Bambu validator (even just lib3mf structural validation) would
  close most of that gap.
- The `apiParity` unit test silently validated only ~⅓ of `partwrightAPI` (80 KB
  window on a ~300 KB object). A new API method nearly tripped it for an unrelated
  reason. That kind of "passes for the wrong reason" guard is worse than no guard.

## Learned
- Adding the Bambu plate layer is NOT color-neutral: the `BambuStudio-` marker
  flips Bambu into project mode where it reads `extruder`/`paint_color` and may
  ignore the generic `m:colorgroup` the existing exporter relied on. Plates and
  color are coupled through that one marker — worth surfacing to the user as a
  real complication, which changed the plan.
- `coloring a NON-active part` was the hidden hard part, not the 3MF format:
  the active part's colored mesh is in memory, but others need their code re-run
  AND both color layers (code `api.label`/`api.paint` + saved manual paint)
  resolved off the live editor. Extracting a pure `composeTriColors` from
  `buildTriColors` let me reuse the exact compositor without touching globals.

## Longed for
- A `prompts/`-style note in the PR-description loop is great, but I'd have moved
  faster with a one-page "Bambu 3MF project format" reference doc in `docs/` so
  the next agent touching export doesn't have to re-research the whole format.
  Considered writing one; deferred to keep the PR focused.
