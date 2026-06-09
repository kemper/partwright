---
session: "a7f3c2"
timestamp: 2026-06-07T22:10:19Z
sequence: 7
---

## Human

A pre-production audit surfaced several places where the docs/content had
drifted from the shipped code: the changelog was missing recently merged
user-visible features, the CLAUDE.md architecture list and slash-command table
were stale, and the ai.md subdoc index plus the textures subdoc itself didn't
match the actual tool surface. Fix them — docs/content only, no runtime changes.

## Assistant

Verified each claim against the source before writing, then applied
documentation-only edits:

- Added a June 7, 2026 changelog entry to `whatsNew.ts` covering voxel
  `rotate()`, the 3D-printable AI toggle, AI voice input, and per-session
  camera persistence, matching the existing date-grouped `WeekEntry` shape.
- Refreshed the `src/surface/modifiers.ts` architecture bullet in `CLAUDE.md`
  to describe the fabric-texture family and list the new sibling modules
  (UV + GPU paths).
- Documented `/portrait` (alias `/bust`) in the `CLAUDE.md` slash-command table.
- Added the `textures` row to the `readDoc` subdoc table in `public/ai.md`.
- Added the `quality?` (1–5 mesh detail) param to the six texture signatures
  and parameter tables in `public/ai/textures.md`.

## Key decisions

- Treated today (2026-06-07) as a new date group at the top of the changelog
  rather than folding into the June 5 entry, matching the file's per-day
  grouping convention and keeping newest-first ordering.
- Cross-checked the texture tool schemas in `src/ai/tools.ts` (every `apply*`
  texture declares `quality` integer 1–5, default 3) and the
  `SurfaceModifierId` union + exported `apply*` functions in
  `src/surface/modifiers.ts` so the prose lists exactly what exists — avoiding
  introducing fresh drift.
- Used root-relative phrasing and kept descriptions concise to match the
  surrounding entries/rows.
