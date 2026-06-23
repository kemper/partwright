---
session: "wauien"
timestamp: "2026-06-13T12:21:16Z"
model: claude-opus-4-8
tools: [explore-subagent, model-preview]
sequence: 1
---

## Human

Working on a figure builder; noticed the figures all look like white people,
and a recently-merged Afro hair feature looks odd on the existing (white)
figures. Doesn't want stereotypes (e.g. only dark-skinned figures with Afros),
but recognizes there's no diversity right now. Skin-color control is one option,
but asks what *more* can be done to allow more diversity in the figurine engine
API. After review, chose to do all three tiers in one PR — but first wanted to
see preview images of variations before any catalog rework, and chose to BOTH
diversify existing catalog figures and add new ones.

## Assistant

## Key decisions

**Diagnosis.** The homogeneity had two distinct causes. (1) Skin tone is *not*
an engine parameter — geometry is colourless until the caller paints by label —
so the "all white" read came entirely from the catalog palettes (all between
`#d4956a` and `#f5ccad`) and the canonical `figure.md` example hardcoding a light
peach `[0.95, 0.78, 0.66]`. (2) The face had almost no physiognomic axes (nose =
`tipRadius`+`length` only, fixed jaw/cheek, no lip fullness), so an Afro sat on a
single Western-default face — the "feature mismatch" the user noticed.

**Three tiers, all in `src/geometry/sdfFigure.ts` (additive, backward-compatible).**
- *Tier 1*: `F.skin(name)` — a curated 12-stop light→deep hex ramp (`porcelain`
  … `ebony`), names describe colour not ethnicity. Returns hex (usable directly
  with `api.paint.label`; matches how catalog palette JSONs store colour).
- *Tier 2*: `F.head(rig, { faceShape, jaw, chin, cheek })` (oval/round/square/
  long/heart/diamond presets × continuous knobs); `nose` gains `width`/`bridge`/
  `flare` (low-flat ↔ high-thin bridge, nostril flare); `mouth` gains `fullness`.
- *Tier 3*: hair styles `locs`, `cornrows`, `boxBraids`; new `coils` (4c) texture
  on any style.

**Byte-identical defaults.** Every new param defaults to a no-op so existing
figures/bakes don't drift — verified by unit probes (the `cheek` lateral offset
and `coils` amp were specifically tuned to preserve the original head and avoid
fragmenting the cap).

**Robustness lessons (caught via `model:preview` component counts).** Thin box
braids rooted on the varying ellipsoid surface detached (48 components) → root
them *inside* the scalp so the first capsule welds; their default `wavy`
displacement necked the thin strands in two → box braids stay smooth by default.
The `coils` amplitude pinched the afro shell into pieces → softened amp under
cell·0.5. Cornrows initially read as a smooth cap → carve parting channels
between raised cords.

**Process.** Prototyped the engine first and rendered three `compare` contact
sheets (skin-tone range, face-shape/feature variation, hair styles) for the user
to approve the direction *before* touching the catalog. Documented every axis in
`public/ai/figure.md` (the in-app/extension AI's reference) with a new
"Diversity" section that explicitly tells the model to vary axes *independently*
and not bundle them into stereotypes. The figure API is code-authored (no UI
affordance), so UI/command-palette parity doesn't apply — `figure.md` is the
discoverability surface.
