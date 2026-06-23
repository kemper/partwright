---
session: "01B8i3Nc4JgG6iV6eAsrYFq6"
timestamp: "2026-06-11T21:50:00Z"
model: claude-opus-4-8
---

## Human

After the grip-frame PR (#601) merged, the user sent a close-up screenshot:
"there is still an issue where the rock guitar guy has his other hand going
through it. What do we need to do to fix?" The screenshot showed the STRUMMING
(right) hand embedded in the guitar body with the fingers poking out the front.

## Key decisions

**Diagnosis (the opposite of the fretting-hand bug).** The fretting hand was
fixed by aiming the neck at the grip *cup*. The strumming hand had the inverse
problem: the body was positioned *on top of* the hand. Probing the coordinates
showed the body's front face at Y=−8.14 while the strum hand centre sat at
Y=−7.74 — i.e. the hand centre was BEHIND the front face (inside the body) and
the relaxed fingers, which extend forward, poked out through it.

**Fix.** Pulled the body back so its front face lands just behind the hand
*centre*, keyed directly off `j.handR` rather than `gR.point`:
`lbY = j.handR[1] + boutH*0.5 + r.head*0.10`. That puts the front face at
≈ Y−7.32, so the whole forward half of the hand (palm + fingers, all at
Y < −7.74) is in FRONT of the surface (resting on it, not through it), while the
back of the hand still overlaps ~0.5 units into the body to stay fused as one
piece. Keying off `handR` (the actual hand position) instead of the grip cup is
what guarantees the clearance regardless of pose tuning.

Verified with a zoomed render of just the body + hands: the hand now sits on the
front face. Final: manifold, componentCount 1, genus 2, all 11 labels resolve.
Rebaked `rocker.partwright.json`. Shipped as its own small follow-up PR (#601
had already merged).
