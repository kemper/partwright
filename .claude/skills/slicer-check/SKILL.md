---
name: slicer-check
description: "Validate a 3MF print job with the real slicer: one command exports a model through the app (or takes a .3mf), has Bambu Studio's own CLI render and slice it, cross-checks that against our 3MF reader, and returns a JSON report. Use when changing 3MF export, paint-to-filament mapping, plates or placement, or when checking that a painted model will print in the intended colours. Development tool only; nothing here ships in the site."
---

# Slicer check

`model:preview` shows you the **model**. This shows you the **print job**: what
the real slicer makes of the 3MF the app exports. Use it as a test while
building, the way you would run a unit test.

## When to run it

- You changed anything on the 3MF path: `src/export/threemf*.ts`,
  `paintColor3mf.ts`, the project templates, plate layout or packing, or the
  import parser `src/import/parsers/threemf.ts`.
- You changed how paint becomes filament: palette/slot mapping, colour merging,
  `api.paint.*` or label colours as they reach the export.
- You built a painted model for a user who intends to print it and want to
  confirm the colours and placement before handing it over.

Not for: geometry-only questions (use `model:preview`), or anything a user of
the site needs. The slicer cannot be bundled or called from the app.

## Setup, once per container

```bash
node scripts/slicer-cli.mjs install --apt
```

Downloads one pinned slicer release (256 MB) into the gitignored
`.partwright/slicer/` and installs four Ubuntu packages. About a minute.
`node scripts/slicer-cli.mjs status` shows what is missing. Run `npm ci` first
if `node_modules` is absent.

## The command

```bash
node scripts/slicer-cli.mjs check model.js --expect-filaments 3     # code -> real app export -> slicer
node scripts/slicer-cli.mjs check exported.3mf                      # a file you already have
node scripts/slicer-cli.mjs check model.js --no-render              # numbers only, fastest
node scripts/slicer-cli.mjs check model.js --views 0,10,11,12       # other cameras
node scripts/slicer-cli.mjs check exported.3mf --expect-objects 4 --expect-plates 2
node scripts/slicer-cli.mjs check --current --export-opts '{"plateLayout":"grid"}'   # the daemon's open session
```

- A **model file** (`.js`, `.scad`) is run in the real app through the
  warm-browser daemon and exported with `export3MFObjectsData({ bambu: true })`,
  so the file under test is what a user would download. The first call starts
  the daemon (10-60 s); later calls reuse it. `--printer <id>` picks the profile
  (default `p1s`).
- A **`.3mf`** is checked as-is.
- **`--current`** exports whatever session the daemon has open, for what one
  code file can't express: several objects, brush paint, an imported mesh. Set
  the session up first with `node bin/partwright.mjs call <method> '<argsJSON>'`
  (`createSession`, `runAndSave`, `createObject`, `paintRegion`, …), then check.
- **`--export-opts '<json>'`** passes extra `export3MFObjectsData` options
  (`plateLayout`, `packStrategy`, `nozzle`, `filament`, `split`, …) for a model
  or `--current` export.
- Exit code: `0` every check passed; `1` a check failed, or the tool could not
  run (stdout then carries `{ ok: false, error }`, including when the slicer is
  not installed: `check` never installs anything itself); `2` bad arguments
  (message on stderr, no JSON). The slicer's own output goes to
  `<out>/slicer.log`.
- Output lands in `.partwright/slicer-check/<name>/` unless you pass `--out`.
  **That folder is replaced on every run.** A custom `--out` must be new,
  empty, or a folder this command created; it refuses anything else, and any
  folder that contains the input file, the repo or your home directory. To
  re-check a `.3mf` a previous run exported, pass a different `--out`.

## Reading the report

Read `ok` and `checks[]` first. Each check is `{ name, ok, detail }`:

| Check | A failure means |
|---|---|
| `reader-parses` | Our own 3MF reader (the app's import path) could not parse the file. |
| `slicer-loads` | The slicer refused the file. `detail` has its error. Fix the writer before anything else. |
| `slicer-renders` | A plate render failed or the slicer crashed during one (only present when rendering). |
| `slicer-slices` | It loaded but could not produce G-code (off the plate, empty layers, bad profile), or it crashed mid-slice. |
| `object-count` | Our reader and the slicer disagree on how many objects the file holds. |
| `object-sizes` | An object's size differs by more than 0.05 mm: a transform or unit problem. |
| `objects-on-bed` | An object in the file does not start at z = 0. |
| `filaments-used` | The filament slots our reader says are painted are not the ones the slicer extruded: paint was lost or mis-encoded. |
| `expect-*` | Your own `--expect-filaments/objects/plates` did not hold. |

Then the numbers:

- `file.filaments[]`: every declared slot with its colour and how many
  triangles it paints. A slot at 0 triangles is declared but unused.
- `slicer.plates[].filaments[]`: grams per slot. `grams` is model material,
  `totalGrams` includes purge, `used` is true for any amount above zero. A colour that should be a thin accent but weighs
  as much as the body is painted over far more than intended.
- `filamentChanges`, `printSeconds`: the cost of the colour layout.
- `warnings[]`: slicer warnings per plate, triangles the slicer repaired, split
  paint our reader collapses.

## Look at the picture at checkpoints

Passing checks do not prove the paint is where you meant it. Paint is stored
per triangle, so a band painted across a face made of two big triangles comes
out as a diagonal wedge: three filaments, every check green, wrong print.

`renders.sheet` is a contact sheet of the slicer's own plate renders. `Read` it
when you first get a model passing, after any change to paint, and before you
tell a user a print job is ready. For repeated passes on the same model, keep
to `--no-render` and the numbers, or delegate the looking to a subagent so the
images stay out of your context.

If paint edges are jagged or follow triangle diagonals, the mesh is too coarse
where the colour boundary runs: refine it there (or split the geometry along
the boundary) and re-check.

## What it cannot tell you

- **Whether the desktop app opens the file.** The command line loads projects
  through a different code path than the GUI. Load crashes specific to the GUI
  still need a person to open the file. Say so when you report a result.
- **The underside or a free camera.** Seven fixed views at 512 px
  (`--views`: 0 iso, 1 top-front, 2 left, 3 right, 10/11/12 other isos). Use
  `model:preview --view az,el` on the model for anything else.
- **Other slicers.** This is one pinned Bambu Studio release. OrcaSlicer and
  PrusaSlicer behave differently.
- **CI.** The slicer is not installed in GitHub Actions, so this is a local and
  cloud-session check. The pure report logic has unit tests
  (`tests/unit/slicerReport.test.ts`).

## In a PR

When a PR touches the 3MF path, run the check on a painted model that
exercises the change and put the outcome in the PR body: the command, `ok`,
any failed check, and the limits above. Upload the sheet with
`npm run pr:screenshots` if the change is visual. Only render the app's own
content: never a user's third-party model.

## Lower level

`node scripts/slicer-cli.mjs run -- <slicer args>` passes arguments straight to
the slicer (`--export-png`, `--slice`, `--export-3mf`, `--arrange`, …). Always
give `--outputdir`. See `docs/headless-cli.md`.
