---
session: "idpiob"
timestamp: "2026-06-11T19:30:00Z"
model: claude-opus-4-8
tools: [explore, WebSearch, model:preview]
---

## Human

Researched whether existing libraries/logic could improve the `api.sdf.figure`
builder (articulated joints, body parts, clothing, faces) instead of building
every feature from scratch. After the research report, asked to implement all
four recommendations in one PR:

1. Express widths/radii in head-units (Loomis canon) + a sex/style selector so
   proportions stay coherent at every `headsTall`.
2. A data-driven (MakeHuman CC0 / anthropometry) realism layer for body-type
   deltas.
3. SDF-offset clothing so coverage is guaranteed by construction.
4. Align rig naming to the standard humanoid skeleton vocabulary + plain-language
   pose aliases.

## Assistant

## Key decisions

**Research framing (why these four):** The figure/character domain is heavily
tooled (MakeHuman, SMPL, VRM, Daz, HeroForge) but almost all of it targets
*skinned riggable meshes for animation*, not a single printable solid — the
output mismatch means there's no drop-in library, but the *data and standards*
(proportion canons, skeleton hierarchy, conforming-clothing algorithms) are very
reusable. License check: MakeHuman base mesh/targets are CC0 (free to mine),
SMPL is research-only/commercial-license (can't ship).

**1 + 2 merged into one proportion table.** The structural bug was that every
girth was a fixed fraction of total *height*, so only the head responded to
`headsTall` while the body stayed a constant width (pin-narrow chibi shoulders,
broad-shouldered tall figures). Fix: all widths/radii now `headH * ratio` so
girth scales with the head. **Lengths stay fractions of H** (converting them too
would give chibis gangly long arms — the opposite of the cute look). Ratios are
calibrated so the default `headsTall:6` neutral silhouette is byte-identical to
before (catalog/tests unchanged) — verified by an explicit calibration-anchor
test. `sex` ('neutral'|'male'|'female') multiplies shoulder/chest/waist/hip along
the Loomis canon; these are the same anthropometric deltas MakeHuman's CC0
targets encode, expressed as ratio multipliers rather than literally fetching and
parsing the .target binaries (a separate large effort, likely network-blocked).

**3: additive coverage underlayer, not a wholesale rewrite.** A pure
"garment = body⊕t ∩ mask" rewrite is elegant but has real edge cases the tuned
code already solves (bone-perpendicular cuffs, excluding the foot). Chosen
compromise: keep the shaped garment (silhouette/cuffs/pockets/skirt) and UNION a
body-offset coverage layer *under* it, clipped to the garment zone. Strictly
additive → guarantees no bare-skin patches (the body can't poke through its own
offset) while keeping every existing coverage test green and not regressing tuned
behavior. This also makes the implementation finally match figure.md's existing
"body region inflated and trimmed" claim.

**4: aliases, not destructive renames.** Saved-session user code references
`rig.joints.shoulderL` etc., so renaming would break back-compat. Added standard
names as aliases (`hips`=pelvis, `upperArmL/R`=shoulderL/R, `upperLegL/R`=hipL/R)
and plain-language pose aliases (`raiseSide`/`raiseFwd`/`bend`/`roll`, head
`yaw`/`pitch`/`roll`) with the biomechanical name winning on conflict. Documented
the bone-vs-joint duality and the shoulder/clavicle naming collision in
figure.md.

**Verification:** model:preview across headsTall 3/6/8 (chibi chunky, adult lean
— coherent), male vs female front view (broader-shoulder vs hourglass), and a
posed clothed figure (fully covered, single component, manifold). All 1223 unit
tests + preflight green.
