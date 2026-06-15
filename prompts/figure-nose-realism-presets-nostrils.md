---
session: "01U1EDvT"
timestamp: "2026-06-14T19:55:00Z"
---

## Human

"Multiple iterations have improved the faces in the figure API, but the nose
still needs refinement — the noses are under-detailed. Significantly upgrade the
realism: nostril indentations, plus nose-type presets (big/small/long/short).
Investigate the Figure API thoroughly, write a plan file, create CLI previews to
show direction, and if confident update some catalog models and open a PR."

## Assistant

## Key decisions

**Root cause: the default nose early-returned a bare tapered ridge.** `buildNose`
(`src/geometry/sdfFigure.ts`) returned just the `dorsum` capsule when
`width:1, flare:0` — and most figures pass only `tipRadius`, so they all got a
thin lump with no tip, no alae, and **no nostrils**. Even flared, the result was
a smooth 3-lobe blob. Verified with a head close-up before/after.

**Redesigned `buildNose` so every nose is realistic by default**: dorsum + a
tip bulb (always, oriented to the head pose) + fleshy alae + two **carved
nostril cavities** with a surviving columella/septum, plus an optional dorsal
hump. Consciously changed the default shape (the requested global realism
step-up); the API surface and all existing option names/ranges are unchanged, so
old sessions just re-render with a better nose.

**Nostril placement is MEASURED, not guessed.** The flared alae `smoothUnion`
bulges the underside well past the analytic tip (the surface sat ~1.65·tipR
below the tip vs a guessed ~0.6), so a fixed-offset cavity carved a *buried
bubble* that never opened — confirmed by an SDF probe (`vite-node`, walking
`evaluate` down each nostril column). Fixed per the CLAUDE.md "measure when
smoothUnion is involved" rule: `surfaceDrop()` samples the lower surface along
each column and straddles the cavity across it so it breaks through and tunnels
up into the tip. Re-probed: a clean positive (carved) pocket from the surface
upward; renders show real paired nostrils from below.

**Eight presets** (`nose.type`): `straight` (default), `button`, `snub`,
`roman`, `aquiline`, `broad`, `pointed`, `bulbous` — each a full axis bundle
that the explicit keys (`tipRadius/length/width/bridge/flare` + new
`upturn`/`bump`/`nostrils`) **override** (not multiply), so `{type:'broad',
flare:0.5}` works intuitively. Added a fine **nose detail sphere** to
`faceDetail` (+`noseEdgeLength`) so the nostril rims/septum mesh crisply.

**Verified**: isolated nose front/underside/profile high-res crops; an 8-preset
montage; SDF probe for the carve; 5 example figures retyped to presets
(toddler→button, grandpa→aquiline, strongman→broad, sumo→bulbous,
cornrows_runner→broad) all `isManifold`, `componentCount 1`. Updated unit tests
(nostril-carve concavity, preset distinctness, upturn, validation) and docs
(`public/ai/figure.md`, JSDoc). Preflight green (1394 unit tests).

**Deferred**: re-baking the catalog `.partwright.json` thumbnails needs the
browser bake pipeline (dev server + Playwright) and touches every face figure —
filed as a follow-up rather than bloating this PR. The example sources and the
API are updated; the gallery thumbnails regenerate separately.

## Follow-up iteration (same PR) — "too generic/smooth/bland"

The user reviewed v1 in fully-featured colored busts (the key ask: *don't judge
the nose in isolation — render real faces with eyes/lids/brows/mouth/hair/skin*)
and found the noses bland, shallow, and the nostrils "turning inward."

**Expanded the dimension set** (user-approved): added `projection` (face→tip
stand-off — the main "not flat" lever), `bridgeWidth` (pinched↔broad),
`profile` (signed −scoop..+hump, with `bump` kept as the positive alias),
`tipSize`, `tipShape` (round/pointed/bulbous/cleft), and `nostrilSize`
(independent of `flare`). Rebuilt the dorsum as a chain of head-oriented
ellipsoids — **taller than wide** with sidewalls (a real nasal ridge, not a
round tube) — and projected the whole tip assembly off the face.

**Reshaped the nostrils** from thin vertical inward slits to larger, rounded,
**outward-splayed** openings (22° yaw) with a defined columella; tightened the
tip-bulb weld and halved `noseEdgeLength` for crisper, less-hazy definition.

**Verification was in COLOR full busts** via `model:preview` (which DOES resolve
`api.paint.label`), four diverse characters (straight/broad/aquiline/button ×
varied skin/hair/eyes/lips) shown front + 3/4 + grayscale underside close-ups.
The unit nostril-carve test was made geometry-robust (a 3D grid scan asserting
the carve removed material, replacing a brittle hardcoded sample point that the
projection broke).
