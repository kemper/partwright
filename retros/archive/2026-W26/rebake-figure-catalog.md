# Retro — re-bake the entire figure catalog (#777)

## Liked
- The shod-figures precedent (`rebake-shod-figures.cjs`) was exactly the right
  template — in-place re-bake that re-runs each entry's stored code, replays
  paint, and splices ONLY geometry-derived fields keeps the diff to just the
  re-baked geometry + thumbnail. Generalizing it (auto-discover by
  `code.includes('sdf.figure')`) made the 51-entry set self-maintaining.

## Lacked
- No standing "re-bake all entries that use builder X" script — every shared
  builder fix (sdfFigure here, footwear before) spawns a one-off re-bake
  script. `scripts/rebake-figure-catalog.cjs` is now reusable for any future
  sdfFigure change, but a generic "rebake catalog entries matching predicate"
  runner would kill this whole class of one-offs.
- Thumbnail size had silently drifted: the older shod re-bake hard-coded
  `renderView({size:640})`, leaving 14 entries at 640×640 while the canonical
  catalog tile (via `exportSession`) is 500×500. No lint caught the mismatch.

## Learned
- **A catalog entry's stored `code` dispatches into the LIVE engine/builder at
  bake time** (`api.sdf.figure` → `src/geometry/sdfFigure.ts`). So a fix to a
  shared builder propagates to every entry just by re-running its code against
  the new code — no source edits, no palette/source remapping needed.
- **Batch bakes MUST use a fresh page per entry.** Reusing one Playwright page
  across `createSession` calls tears down `window.partwright` after the first
  bake (`Cannot read properties of undefined (reading 'createSession')`). The
  shod script already knew this (freshPage per entry); I rediscovered it the
  hard way after a 50/51-fail run. Worth a one-line note in CLAUDE.md's catalog
  section.

## Longed for
- A `model:preview`-style headless path for catalog *thumbnails* so face-level
  QC (is the nose torn? are lips sculpted?) doesn't depend on a full xvfb bake +
  eyeballing 500px iso tiles where the face is ~30px. The fix is in the geometry
  but invisible at catalog-thumbnail scale; I had to lean on the busts
  (face-focused) as proxies.
