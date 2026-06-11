---
date: "2026-06-11T04:00:00Z"
task: "feat: FK hinge fixes + sculpted hands + hair variants + 10 catalog bakes (PR #585)"
areas: [sdf-figure, fk, catalog, subagents, verification]
cost: high
---

## Liked / Worked
- **The previous session's handoff notes were the whole onboarding.** The "work loop that works" section (bisect don't tune, probes over pictures, trust numbers over comments) was applied verbatim and paid off three separate times: the reader's genus 23 was pinned on the book in two probe renders, the karate genus 5 on the headband-vs-hair graze in one, and the buried-eyes bake failures were confirmed/fixed via the headless paint-op probe without a single browser round-trip.
- **Five parallel model-sculpt agents for five new figures.** Each owned its render→look→adjust loop in its own context; the main context never saw their intermediate PNGs. ~75–125k tokens each, all five returned working figures. Writing the initial drafts myself first (so the agents started from correct API usage) plus a "known draft weak points" list in each spec seemed to be what kept them on-rails.
- **The bake script's paint step as a gate.** It caught two buried-eye failures (and indirectly the blindfold headband) that all my preview renders had missed — the labels list + PAINT FAILED output is exactly the right failure surface.
- **Verifying the elbow-sign bug by hand-deriving the rotation before touching code.** Five minutes of Rodrigues algebra confirmed the comment asserted the opposite of the math, and also surfaced the twist-sign pairing needed to keep the documented double-biceps recipe stable — the existing twist unit test then passed unmodified, which was the design goal.

## Lacked
- **Palette files for catalog re-bakes don't survive a fresh container** (.plans is gitignored). Reconstructed them from each baked entry's `colorRegions` (`descriptor.kind === 'byLabel'`); workflow recorded in the rebake prompt log. Either commit palettes somewhere durable (docs/ or alongside the catalog) or teach build-catalog-entry.cjs a `--palette-from-existing <entry.json>` flag.
- **A genus budget assertion in the bake script.** The gates I checked by eye (genus ≤ 2–3) aren't enforced; `--expect-components` exists but a `--max-genus` doesn't. The headband regression (2→5) was only caught because I happened to re-read the stats line.
- **Eye-dome protrusion is ~1 face-detail march cell at default sizes** — marginal by construction. Two of five new figures landed under it (label resolved to 0 tris). The eyes builder should derive its protrusion from a cell-count floor, like the mouth cavity's `cavH` floor, instead of `0.28 × radius`.

## Learned
- **cross(dir, fwd) hinges are degenerate-unstable, not just degenerate-broken.** Near flex 90 with small abduct, the cross product is dominated by the abduct component and the hinge swings 90° (frog-sit). Fallbacks on `len < ε` don't catch "almost parallel". Frame-derived axes (rest hinge carried through the bone's own rotations) are stable everywhere and equal the cross-product form in the cases that were already tuned. The ARM hinge still uses the cross form — deliberate (twist DOF + freshly tuned poses), but it has the same instability near flex ±90 and should eventually migrate the same way.
- **Near-tangent rings: a prop ring around a shelled region (headband around hair cap) must pin its centerline ON the shell surface and be ≥2 cells fat** — slightly inside grazes from within, slightly outside grazes the gap. Same class as the teeth-band rules in mouthCavityFrame.
- **Props sized to "kiss" the hands are micro-handle factories** — the reader's book had to be wider than the hand span so its faces cross the palms transversally. "Touching" is the worst clearance; bury or clear decisively.

## Longed for
- **`--max-genus N` and `--require-labels a,b,c` flags on build-catalog-entry.cjs** so the figure-bake gates are mechanical instead of eyeballed stats lines.
- **A pose-recipe regression suite**: the documented recipes in figure.md (sitting, double-biceps, ballet fifth, lunge) asserted as rig unit tests, so an FK change that breaks a documented recipe fails in vitest instead of in a sculpt agent's render loop.
