---
session: "inverse-cad"
timestamp: "2026-07-06T00:30:00Z"
model: claude-fable-5
sequence: 59
---

## Human

"I don't wanna ship the original Benchy STL file. It's really just the
new remake that we've made that I want."

## Assistant

## Key decisions

Removed `converged/benchy/target.stl` (11MB, CC BY-ND) from the branch —
the reconstruction (`candidate.js`, catalog entry) stays. The converged
README now tells re-verifiers to download the original from
3dbenchy.com and pass its path to eval.mjs, instead of claiming verbatim
redistribution. Also corrected the README's stale simplify(0.04) →
0.033 (what the entry actually ships). Note: the file remains in branch
history; a squash-merge keeps it off main's history.
