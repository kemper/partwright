---
session: "01Sgg6hf413pfCQJoXRhLnA9"
timestamp: "2026-10-09T15:08:54Z"
---

## Human

[Attached: Cloud_Guitar.partwright.json — a 9.2 MB exported session of a
full-size Cloud-style guitar: 48 versions across two parts, 263 chat
messages, 5 reference-photo/screenshot attachments.]
Please create a new Catalog entry for this project. Tag it as a real tested
project.

## Assistant

## Key decisions

**"Real tested" = `printTested: true`.** The manifest already has a
`printTested` flag driving the "✓ Print-tested" tile chip; no entry used it
yet, so this is the first. Set it on the new `cloud-guitar` manifest entry
(tag `decor`, alongside the other instrument/props entries).

**Re-baked instead of committing the raw export.** The upload is 9.2 MB (chat +
photo attachments + every iteration) against the 1.5 MB `lint:catalog` gate,
and has no thumbnails. Baked a two-part entry with
`scripts/build-catalog-entry.cjs --parts-manifest` from the final version of
each part: the print kit (Part 2's last version, default params — pinFit 0.2 mm,
the user-confirmed fit) and the single-piece display guitar (Part 1, v38).
Dropped chat and attachments (one is a third-party product photo); carried over
the session's [REQUIREMENT]/[DECISION] notes, skipped its stale [TODO]s, and
added a [MEASUREMENT] note recording the print test. Result: 96 KB.

**Part order: print kit first, guitar last.** The static /catalog tile uses the
LAST version's PNG and import opens the FIRST part, so this order gives the tile
the recognizable assembled guitar while the editor opens on the printed kit.

**Fixed blank thumbnails for large models (src/renderer/multiview.ts).** The
kit is ~1.65 m wide; the offscreen thumbnail/renderViews cameras used a fixed
far plane of 1000 while sitting 2x maxDim away, so anything over ~500 units
clipped to a blank image. Clip planes now scale with the model like the
interactive viewport already does, with floors that keep every render of a
model up to 100 units byte-identical.

**Test update.** tests/catalog.spec.ts asserted every tile reads "Untested";
it now asserts the Cloud Guitar carries the verified chip, the rest are
Untested, and searching "print-tested" surfaces exactly the verified tiles.
