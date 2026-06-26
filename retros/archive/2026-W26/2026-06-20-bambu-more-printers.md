# Retro — Bambu printer picker + "more models"

**Liked**
- BambuStudio's bundled profiles + the headless slicer CLI were a true source of truth: every "exact string" (printer_model, process-preset suffix, bed) and every structural fact (single vs dual nozzle, flush-matrix = nozzleCount×N²) came from real data, not guessing. The `--slice` loop caught load/compat errors I could never have reasoned out.

**Lacked**
- I validated the data layer only on the base==model case (P1S, H2C) and shipped #759 with a latent `rc -17` (process-preset incompatibility) for every NON-base printer (H2D/H2S). The base-printer case is the *least* representative one to test. Lesson: when a value is overridden onto a shared base, validate an entry where the override actually differs from the base — not the one that coincidentally matches.

**Learned**
- Bambu's printer↔process compatibility gate is `print_compatible_printers` (+ `print_settings_id`), not the printer label; overriding `printer_model` alone leaves the base's process, which Bambu rejects.
- Process presets are SHARED across printers (P1S/X1/X1C/X1E all use `@BBL X1C`) — the mapping is per-preset `compatible_printers`, not a name transform.
- A stale Vite dev server silently served old code to a Playwright `import()` mid-debug, making a correct fix look broken. `pkill -f vite` before re-validating a source change driven through the dev server.

**Longed for**
- A headless "does this 3mf open in the Bambu GUI" check. The CLI's `--slice` validates load+slice but NOT the GUI load_files path that caused the original crash — so GUI confirmation still falls to the user. A scriptable GUI-load smoke test would close the last validation gap.
