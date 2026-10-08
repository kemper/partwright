---
date: 2026-06-17
task: Multi-part 3MF export — Bambu/Orca multi-plate (PR #681)
---

## Liked
- The **headless slicer validation loop** was the turning point: an OrcaSlicer
  AppImage run under `xvfb` via `--appimage-extract-and-run --slice 0` (no FUSE,
  no source build) loads a 3mf through the *real* `bbs_3mf` loader — exit 127 / no
  `result.json` = load failure, `result.json.sliced_plates` = plate count. Before
  it, four blind hardware iterations failed (warning → off-centre → 1-plate →
  crash); after it, the fix converged. Reproducing the bug in the actual consumer
  beats any amount of spec-reading.
- Bisecting the *generated file* against a *known-good file* one package member at
  a time (swap each into the loading file, re-run the slicer) pinned the final bug
  (`plater_name` must be empty) that no amount of XML-validity checking caught.

## Lacked
- A way to run the real downstream consumer (slicer) was not part of the toolkit —
  I only discovered it was feasible when the user suggested it. For any
  export-format work (3MF/STEP/etc.), "can we validate against the real importer?"
  should be an early question, not a last resort.

## Learned
- **`isolation: "worktree"` branched the implementer from STALE `origin/main`, not
  my feature branch HEAD.** Its output was a parallel rewrite missing all my
  session work (−1481 lines) and couldn't be merged — I had to hand-port its one
  valuable function. If a worktree subagent must build on in-progress branch work,
  verify/instruct its base explicitly; don't assume it forks current HEAD.
- A subagent's "DONE, validated" can be optimistic: the implementer claimed its
  builder output passed Orca, but its *committed code* re-added a key its own
  bisection had dropped (`printable_area`) and its real output 127'd. Re-validate
  delegated work against the same gate yourself before trusting it.
- Bambu/Orca multi-plate needs the **3MF production extension** (split
  `/3D/Objects/*.model` component files), a non-empty-enough `project_settings.config`,
  and **empty `plater_name`** — inline meshes / missing project config / named
  plates each silently collapse to one plate or fail the load.

## Longed for
- A repo helper like `npm run validate:3mf -- <file>` wrapping the OrcaSlicer
  headless check (download-once AppImage + the slice/parse recipe), so 3MF export
  changes can be regression-checked locally and (with a cached binary) maybe in a
  dedicated CI job. The recipe currently lives only in this session's /tmp.
- A faster generate→validate inner loop: each iteration meant a Playwright run to
  emit the 3mf (browser-only `export3MFPartsData`) + a ~10s slicer run. A
  node-side path to build the 3mf bytes headlessly would have shortened it.
