---
date: 2026-06-18
branch: claude/quirky-cerf-jik841
files_changed:
  - src/export/bambuProjectTemplate.json
  - src/export/threemfProject.ts
  - tests/threemf-multipart.spec.ts
---

## Human

The Bambu 3MF still crashes Bambu Studio — the first open worked (I jumped to
Preview fast) but the next three crashed. Here's the file, and here's the macOS
crash report. (Attached: generated .3mf + full BambuStudio crash log.)

## Assistant

The crash report was decisive where headless validation never could be. The
faulting thread: a null-pointer read (`EXC_BAD_ACCESS at 0x0`) inside
`Slic3r::GUI::Plater::priv::load_files`, reached from `post_init` on a
`wxIdleEvent` — and register x10 held `0x746e656d616c6966`, which is the ASCII
bytes "filament". So load_files null-deref'd while binding objects to filaments.

Root cause: our `project_settings.config` named a filament *preset id* but shipped
only 6 keys — none of the per-filament **arrays** (`filament_colour`,
`filament_type`, `filament_ids`, `filament_map`, …) that load_files indexes when
mapping each object's extruder to a filament. The lookup ran off the end → null.
Intermittent because load_files races the background user-preset loader on idle
(the one no-crash open won the race / Preview took a different path first). The
Bambu CLI never caught it: `--slice` uses a different loader than the GUI's
`Plater::load_project`, which is exactly why the file sliced clean yet crashed on
open — and why OrcaSlicer was never a valid proxy (the real reference itself fails
in Orca but opens in Bambu).

Fix: stop hand-rolling a minimal config (every comment in the old code optimized
for an Orca segfault that doesn't apply to Bambu). Ship the **complete** config
from the user's own known-good reference — a full Bambu Lab H2C profile, 536 keys,
all filament arrays consistently sized — as `bambuProjectTemplate.json`
(filament_colour neutralized to greys for the single-colour base). Since the GUI
load path can't be exercised headlessly, structural fidelity to the file that DID
load is the safety guarantee.

The H2C profile also changed the bed to 330×320, which surfaced a second,
independent bug: the old plate placement (240 mm stride / 90 mm corner offset,
tuned for a 180 mm bed) put a part on a plate boundary → Bambu CLI "Object …
partly inside, can not be sliced." Bambu assigns objects to plates by world
position, so each part must sit at the CENTRE of a distinct plate cell. Now derive
the bed size from the template's `printable_area`, centre each part in its cell,
and use the ~410 mm H2C plate stride (from the reference). Re-sliced in the Bambu
CLI: `return_code 0`, "Success.", 3 plates, one part each.

Scope: this is the single-colour crash-fix base (all objects on extruder 1).
Per-part colour (distinct extruder per part + sized filament_colour) stays the
tracked follow-up (#729) — it needs per-filament array resizing that can't be
validated against Bambu's GUI loader headlessly, so it lands once the user
confirms this base opens without crashing. Tests flipped from the old
Orca-invariants (no filament_colour) to the new Bambu ones (complete filament
arrays present, H2C profile); the 3 multipart e2e specs pass.
