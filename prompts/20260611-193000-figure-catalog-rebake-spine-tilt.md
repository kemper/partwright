---
session: "01B8i3Nc4JgG6iV6eAsrYFq6"
timestamp: "2026-06-11T19:30:00Z"
model: claude-opus-4-8
---

## Human

After merging the figure spine/tilt/eyes fix (PR #593), asked for the follow-up
PR that fixes the catalog — rebake the figures whose baked meshes went stale now
that `spine`/`head.tilt` actually do something — and separately to "fix the
guitar player so he just has one normal looking guitar."

## Assistant

## Key decisions

**Which entries need a rebake.** Grepped the catalog: 10 entries use
`api.sdf.figure`; 9 set `spine` and 5 set `head.tilt` (all but
flexing_strongman). Those 9 baked meshes were frozen when spine/tilt were
no-ops, so they're now stale vs their code. flexing_strongman (no spine/tilt,
and eyes already `false`) is unchanged — left it alone. The `eyes`-default flip
affects nothing: every figure already passes `eyes: false` explicitly.

**Verified the now-active DOFs improve the figures before rebaking.** Rendered
the affected figures headlessly: the small authored values (lean ≤7°, tilt ≤6°)
read as the subtle leans/tilts the authors originally reached for — karate leans
into its punch, rocker gets its back-arch. No pose broke; all stayed manifold,
componentCount 1.

**Karate: reduced lean 7→5.** The one regression the now-live spine introduced:
karate's deep front-stance at `lean 7` grazed itself into genus 6 (vs 2). Swept
the lean — genus drops back to 2 at any value ≤6 — and set 5 for margin. The 2°
difference is visually imperceptible; the bake's `--max-genus 3` gate would
otherwise have (correctly) rejected the genus-6 result.

**Bake pipeline.** `build-catalog-entry.cjs` drives a headed sandbox Chromium
for real WebGL, so it needs `xvfb-run` + a running dev server. Baked each entry
with its committed palette (`public/catalog/palettes/<id>.json`) and turned the
quality checks into exit-code gates: `--require-labels <all palette labels>`
(catches a buried/aliased-away painted region) and a per-figure `--max-genus`
(measured genus + small margin, to catch a gross regression without failing on
the figures' existing handles). All gates passed; the `.thumb.png` sidecars the
script writes are untracked inspection artifacts (the real thumbnail embeds in
the JSON), so they're not committed.

**Rocker guitar redesign.** The original guitar read as a tangle of crossing
bars / two guitars because the hand→guitar bridge capsules were as thick as the
neck and spanned the wide solo-pose arms. Redesigned (via a model-sculpt agent)
to a single clean electric guitar — body (two bouts + waist) overlapping the
torso so the union is one piece WITHOUT thick bridges, a long neck + headstock —
then a second pass to seat both hands on it (left fretting the neck, right
strumming the body) so it reads as playing, not gesturing. Stays manifold,
componentCount 1, all 11 labels resolve.
