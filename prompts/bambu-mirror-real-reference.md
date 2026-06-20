---
date: 2026-06-17
branch: claude/quirky-cerf-jik841
files_changed:
  - src/export/threemfProject.ts
  - src/export/bambuProjectTemplate.json
  - tests/threemf-multipart.spec.ts
---

## Human

(After the Partwright Bambu export crashed Bambu Studio repeatedly.) Here's a real
Bambu multi-plate .3mf — mirror it. [uploaded 3_parts.3mf]

## Assistant

The reference (a real BambuStudio-02.05.00.66, 3 parts/3 plates) revealed why our
file crashed Bambu but not Orca: our `model_settings.config` `<object>` entries
were **missing the `<part subtype="normal_part"> … <mesh_stat>` block** that Bambu
uses to build each object's ModelVolume (its absence null-derefs in the GUI). The
reference also showed: wrapper objects use EVEN ids (2,4,6) with `<component
p:path>` to ODD-id mesh objects in separate `/3D/Objects/object_N.model` files;
`<model_instance>` carries `identify_id`; an `<assemble>` block closes
model_settings; and **colour is per-OBJECT via filament assignment, not
per-triangle** (the mesh files carry plain `<triangle v1 v2 v3/>`).

Rewrote `buildBambuPackage` to mirror that structure: even/odd id scheme, `<part>`
+ `mesh_stat` + `face_count`, `identify_id`, `<assemble>`, plain Bambu triangles,
`plater_name=""`, `tz=-minZ` (rest on bed). project_settings.config is a small
BambuStudio-compatible template (printer/print/filament preset ids + bed geometry).

Key validation lesson: **OrcaSlicer 2.3.2 is NOT a valid proxy** — the real
reference itself fails in Orca (exit 232) but slices in the Bambu CLI (exit 0, 3
gcode). So the Bambu CLI is the validator; this build slices there (exit 0, 3
gcode). The Bambu *GUI* crash still can't be reproduced headlessly (GUI won't init
under xvfb), so the user does the final GUI confirmation.

Scope note: this ships SINGLE-COLOUR multi-plate (the structural crash fix). The
reference does per-part colour via a printer-specific filament-map config
(dual-nozzle H2C); replicating that correctly needs GUI validation and is a
tracked follow-up (#729). Goal of THIS change: confirm the file opens in Bambu
without crashing — the milestone we'd never reached. 3 e2e tests pass (asserting
the production-extension + part/mesh_stat/identify_id invariants); only the
unrelated catalog date test (#723) fails in the unit tier.
