---
date: 2026-06-29
branch: claude/confident-carson-gpo63q
files_changed:
  - src/color/meshIslands.ts
  - src/main.ts
  - src/ai/tools.ts
  - public/ai/colors.md
---

## Human

After v3, Opus F got the closest Pomni yet but the eyes still weren't quite
right and the sleeves/legs stayed solid instead of striped. Both Opus agents
named the same three gaps: (1) `modelUpAxis` was returning `null` on the
Pomni kit (threshold too strict); (2) `paintOrientedSlab`/`Stripes` was
needed because paintSlab only accepts world axes; (3) `renderRegion` — a
way to SEE which detectRegions output is the iris before painting it.

## Assistant

Three additions, all sitting on primitives already in the codebase.

**Loosened `modelUpAxis` + added `principalAxisVector`.** Threshold from
0.05 → 0.02 asymmetry; when the normal histogram is still too flat, fall
back to the tallest bbox extent with `confidence` cut in half so callers
know it's an inference. Added `principalAxisVector: [x,y,z]` alongside the
string `principalAxis` so the AI's instinct to want a 3-vector is honoured.

**`renderRegion({triangleIds, withinIsland?, highlightColor?, view?, size?})`
** — the identification fix for `detectRegions` output. Builds a temporary
`triColors` overlay where the requested triangles glow yellow and
everything else stays at `(0,0,0)` which the offscreen renderer already
draws as the light-gray unpainted base. Returns a base64 PNG. Non-
destructive: the persisted region store is not touched. `withinIsland`
frames the camera to just one island so a small iris ring inside Pomni's
205k-tri body isn't lost in a whole-kit view. Pair with `detectRegions
({maxTrianglesPerGroup > 0})` so the caller has `triangleIds` to hand it.

**`paintOrientedStripes({islandIndex, colors, axis?})`** — divides the
island's principal-axis extent into `colors.length` equal bands and
buckets triangles by centroid position along that axis. Each stripe
commits as its own region so a caller can remove one without touching
the rest. `colors: [red, blue, red, blue]` on Pomni's arm produces four
bands red→blue→red→blue along its principal axis. `axis` override lets
the caller pin a specific world axis when the island's PCA guess is
wrong.

**`colors.md` gained two workflow snippets** — a `detectRegions` →
`renderRegion` → `paintFaces` loop for identifying sculpted features,
and a `paintOrientedStripes` recipe for striped limbs. Both wired into
the "match the reference photo" section.

Preflight clean. Follow-up: rerun 2 Opus agents to validate the three
new tools on the Pomni STL. Reference photo is the persistent success
criterion.
