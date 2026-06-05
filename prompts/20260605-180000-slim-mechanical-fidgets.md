---
session: "trusting-dirac"
timestamp: "2026-06-05T18:00:00Z"
---

## Human

Slim down this branch — clear out the other fidgets that aren't mechanical yet and
tidy up this PR.

## Assistant

## Key decisions

**Kept the one verified-mechanical fidget, cleared the rest.** The branch carried
10 static, sculptural fidget models; none had been rebuilt as real print-in-place
mechanisms except the spiral cone. So I removed the other 9 catalog entries (files
+ manifest) and kept the cone, re-baked as an actual mechanism. The `fidget-toys`
group is data-driven from the manifest, so dropping entries cleans the group with
no code change.

**The cone is now a genuine two-part mechanism.** A cone is split by a
full-diameter helical *slab* (thickness = print clearance), then `.decompose()`'d
into two interleaved spiral ribbons that twist apart — `componentCount === 2`,
~0.8 mm gap, ~105k triangles (under the catalog budget). This replaced an earlier
nested-screw detour; the slab+decompose recipe is both simpler and the faithful
match to the reference's two-tone swirl.

**Baking a multi-part entry.** The catalog baker refuses multi-component models by
default (they're usually a failed boolean); here `componentCount=2` is intentional,
so I baked with `ALLOW_MULTI_COMPONENT=1`. The baker rebuilds the manifest entry
without the `group` field, so I restored `group: "fidget-toys"` afterward.

**Scope kept tight.** This leaves the PR as: catalog search + language filters, the
`model:preview` tool, and a single, real mechanical fidget. The remaining
mechanical fidgets land in follow-up work rather than shipping half-built here.
