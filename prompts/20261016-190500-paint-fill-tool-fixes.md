---
session: "charming-bohr-9tr80j"
timestamp: "2026-10-16T19:05:00Z"
sequence: 1
tools: [playwright]
---

## Human

An AI agent painting a scanned figure reported missing tools: bucket fills
(`paintRegion` / `paintConnected`) leave a triangle-sized sawtooth edge (hem,
sock roll, hairline), no despeckle, no way to stop a fill leaking, no region
grow/shrink/union/subtract, no boundary-only mesh refinement. Investigate, then
"create however many PRs you think is right. Stack them on top of each other if
you want, but attach visual and behavioral proof to each as possible."

## Assistant

## Key decisions

**Split into three stacked PRs** (tracked in a `[tracking]` issue): quick fixes
first (this one), then region clean-up ops, then smooth bucket fills — ordered
by cost so the cheap, high-value fixes don't wait on the design-heavy one.

**`paintRegion` tool tolerance bug.** The in-app tool schema said the tolerance
was in degrees, but the console API compares `dot >= tolerance` (a cosine), so
any degree value > 1 matched nothing. Rather than tell models to compute
cosines, the tool now takes `toleranceDeg` and converts; the console API keeps
its cosine contract (documented, back-compat) but now rejects out-of-range
values with a hint instead of failing silently. A legacy `tolerance` in cosine
range still passes through.

**`paintRegion` normal made optional.** The tool schema already marked it
optional but the API errored without it. It now snaps to the nearest face, the
convention `paintConnected` / `paintNearestRegion` already use.

**`paintConnected` clamp exposed to the in-app AI.** `withinBox`/`zMin`/`zMax`
already existed on the console API; the tool schema just never listed them, so
the chat agent couldn't stop a leak. Pure schema + docs.

**Docs recipe over new code for smooth edges (for now).** The smooth-capable
selectors (`paintSlab`, `paintInOrientedBox`, `paintInCylinder`, `paintStroke`)
already clip through triangles; documented a "clamp a triangle short, then fill
to the line with a smooth tool" recipe. Verified the order semantics first —
higher-order (later) regions win on overlap — and that the same-colour smooth
band must sit *after* the neighbouring fill. A real `smooth` bucket fill is the
third PR.

## Assistant

## Review follow-ups (work-reviewer pass over the stack)

**Validate the clamp.** Exposing `withinBox`/`zMin`/`zMax` to the AI meant
malformed values (`{min: 5}`, a string `zMax`) silently became "no clamp" and
could be persisted onto the descriptor. They now return an error. Also gave
`withinBox` real `min`/`max` properties in the tool schema — an untyped object
sanitizes to `properties: {}` for Gemini, which then can't fill it in.

**Unit hint.** The seed-failure diagnostic suggests a cosine; it now also
quotes the equivalent `toleranceDeg` so the in-app agent isn't sent back to
the cosine trap this PR fixes. Corrected the colors.md line claiming
paintRegion always needs an exact seed (it snaps when `normal` is omitted).
