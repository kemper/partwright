---
session: "01B8i3Nc4JgG6iV6eAsrYFq6"
timestamp: "2026-06-11T20:15:00Z"
model: claude-opus-4-8
---

## Human

"Fix the guitar player so he just has one normal looking guitar." (The rocker
catalog figure's guitar read as a tangle of crossing bars / two guitars.)

## Assistant

## Key decisions

**Root cause of the "two guitars" look.** The original guitar connected each
hand to the body with a `bridge` capsule as thick as the neck (`r.hand*0.55`),
and the arms were posed wide (mid-solo, hands out to the sides), so those two
fat diagonal capsules crossed the chest and read as extra necks. The body was
also small and slung very low between the legs.

**Redesign (model-sculpt agents + a deterministic pose pass).** Rebuilt the
guitar as a single clean instrument: an hourglass body (two bouts + waist)
**overlapping the torso** so the union is one face-connected piece WITHOUT any
thick bridge capsules, plus a neck + headstock. Removed both bridge bars. Two
model-sculpt passes got the guitar geometry right but kept fighting the
mirrored-front-view / arm-FK ambiguity, leaving the fretting hand splayed out to
the side.

**Deterministic pose fix.** Instead of guessing FK angles, probed the actual
`rig.joints.handL` for a grid of left-arm poses and picked the one that lands
the hand in front of the left shoulder near the guitar's depth plane
(`armL {abduct:20, flex:55, elbow:120, twist:0}` → handL ≈ [6.5, −7.4, 58]),
then drew the neck **directly to `j.handL`** so it always reaches the fretting
hand in all three axes regardless of FK. The right (strumming) arm hangs down
over the lower bout (`armR {abduct:0, flex:20, elbow:0}`), which the probe
confirmed lands the hand on the bout's front face (fused via the body↔torso
overlap). Now both hands clearly play one guitar; the neck rises at a natural
up-left diagonal.

**Result:** manifold, componentCount 1, genus 3, all 11 paint labels resolve
(guitar = 13063 tris). Rebaked `rocker.partwright.json` with the committed
palette under the same `--max-genus 3 --require-labels …` gates as the rest of
the catalog. Shipped as its own small PR because the catalog-rebake PR (#596)
had already merged with the other 8 figures before this landed.
