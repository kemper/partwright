---
session: "inverse-cad"
timestamp: "2026-07-05T15:30:00Z"
model: claude-fable-5
sequence: 53
---

## Human

(continuation — Benchy convergence agent completed after the catalog was
baked from its interim best)

## Assistant

## Key decisions

**The Benchy is converged — the genericity proof passed.** Final best
(attempt 5 of 6 used): 6/6 MUST + 2/2 SHOULD, chamfer 0.0082mm,
hausdorff max 0.1623mm, IoU 0.9957, genus 5/5. The five handles were
measured, not assumed: the bow hawsepipe pierces BOTH bulwark walls (2
handles) and the cabin's four mouths contribute 3; chimney bore and
stern pocket verified blind. Zero free parameters — every number in the
candidate is a measurement.

**Re-baked the catalog entry from attempt 5** (I had baked attempt 2
before the agent finished polishing): simplify(0.04) → 276k tris,
re-verified empirically (chamfer 0.0133mm, worst 0.159mm). Preserved
the full reconstruction in `scripts/inverse-cad/converged/benchy/`
including the original STL — CC BY-ND permits verbatim redistribution
with attribution, so re-verification works from a fresh clone.

**Ratcheted 4 PLAYBOOK entries** from the agent: §5.25e ledge-exact SDF
override (true z-gradient at measured ledge planes), §5.25f de-phase the
grid from round-number ledges, §5.39 zero-hit ray columns find
through-tunnels, and the §7 trap for genLevelSet's banded fallback
erasing depth-3-nested outers — that one is a real tooling defect, filed
as #886 (workaround: the pure even-odd SDF path, which the converged
candidate uses).

**Agent's genericity verdict, recorded honestly**: the loop core
(turn/probe/gates/§5.37 voxel-genus) needed zero Benchy-specific
babying; the two failures it hit were genLevelSet tooling bugs that any
courtyard-topology or round-number-ledge CAD mesh would trip — fixed
generically or tracked, not patched around.
