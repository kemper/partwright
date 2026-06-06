---
session: "irolyph"
timestamp: "2026-06-06T11:00:00Z"
model: claude-opus-4-8
tools: [subagent, model:preview, single-catalog-entry.cjs]
---

## Human

The Spiral Fidget Cone catalog item won't 3D-print cleanly — the nested
spirals fuse together. Research how these print-in-place spiral-cone fidgets
are designed. Hypotheses to check: (1) a steeper / more-vertical spiral so a
newly-laid layer of one spiral doesn't touch the previous layer of the
neighbour; (2) a larger central cylindrical hole so less plastic touches near
the axis (make it a parameter); (3) drop the ball-on-a-thin-stalk finial that
always snaps off — each spiral should just taper to a point. Redesign the
catalog item; make ~four variations, parametric (slope/turns possibly a
param). Do the research, then make a PR if confident.

## Assistant

## Key decisions

**Research (web).** Confirmed the user's mechanism intuition. Two families
exist; ours is the multi-start intertwined-blade cone. Steeper helix genuinely
helps via the staircase/overhang-offset relationship — a near-vertical blade
climbs mostly in Z, so each layer stacks in its own footprint and doesn't
creep sideways into the neighbour; a shallow helix advances far in XY per layer
and the squished bead welds to the adjacent blade. But steepness *supplements*
a real clearance gap, it doesn't replace it: the wall-to-wall gap must be
>= ~one nozzle width (0.4 mm) or the slicer bridges it regardless of angle.
A central axial void removes the highest-risk close-contact zone near the
axis. Tips must taper blade-width ∝ cone radius and truncate at ~0.8 mm so they
resolve instead of becoming a stalk.

**Root cause of the old model.** Its clearance (0.8 mm) was fine; the killer
was the helix — 5 turns over 50 mm at r=15 is ~6° from horizontal (nearly flat),
so the helicoidal gap is almost horizontal and plastic creeps across it. Plus a
sphere finial on a thin neck.

**Redesign.** One robust generator shared by all four presets: a smooth cone
sliced by N radial helical slab cutters (constant-thickness gap = clearance, so
the gap stays printable at every height while the cone narrows and each blade
pinches to its own point), then `decompose()` -> componentCount === arms.
Parameters: arms (2-5), baseR, height, turns (fewer = steeper), clearance,
coreFrac (tapered central bore, shared taper rate so a constant-proportion wall
survives to the tip). Removed the ball entirely. Verified every preset with
`model:preview` (componentCount, manifold, tri-budget) and a cutaway render of
the internal gap + bore.

**Rejected: a `flutes` surface-grip param** — it fragmented the blades
(componentCount 3 -> 6), so exposing it would break the mechanism. Dropped it.

**Four catalog presets** (same generator, distinct defaults + palette, all
fully parametric): Spiral Twist Cone (2-arm, updates the existing
`spiral-fidget-cone`), Triple Helix Tornado (3-arm), Quad Spiral Spire (4-arm,
tall), Pocket Twist Top (2-arm, squat/steep/big-bore beginner print). Baked via
`single-catalog-entry.cjs` (real thumbnails) with `ALLOW_MULTI_COMPONENT=1`,
re-added `group: "fidget-toys"` to the manifest, and prepended a `[PRINT]`
session note (thin layers, full cooling, no supports, twist-to-free) to each.
