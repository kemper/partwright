---
session: "01B8i3Nc4JgG6iV6eAsrYFq6"
timestamp: "2026-06-11T22:15:00Z"
model: claude-opus-4-8
---

## Human

(Continuing on PR #602, after the strumming-hand fix.) User sent a coloured app
render: "Better, but still passing through." The thin neck visibly ran up
through the FRETTING (upper) hand and the headstock poked out the top.

## Key decisions

**Diagnosis via the grip frame.** Probing `rig.grip.L` exposed the real cause:
`gripAxis = [−0.93, −0.3, −0.2]` (nearly horizontal) while the neck rose
vertically (~+Z). The fretting hand was posed to grip a *horizontal* bar, so a
vertical neck crossed it perpendicular — impaled, not gripped — and `reach`
(fingers) pointed +Z, *along* the neck instead of across it. The pose, not the
neck geometry, was wrong.

**Fix — align the grip axis to the neck by sweeping the pose.** Used the new
grip frame as a *measurement*: swept armL over abduct/flex/elbow/twist and
scored each by `|dot(neckDir, gripAxis)|` (how parallel the grip is to the
body→hand neck line). `armL { abduct:55, flex:40, elbow:130, twist:−30 }` scored
0.996 (0.947 in the full model with the real upper-bout neck start). `twist:−30`
is the key — it rolls the grip so a held bar runs *up* the neck. The neck now
lies in the curled fingers; a close-up render confirms the hand wraps it instead
of being skewered.

This is the grip-frame API paying off twice: first as the anchor (`point`) for
the strumming hand, now as the orientation (`gripAxis`) target for posing the
fretting hand. Final: manifold, componentCount 1, genus 2, all 11 labels
resolve. Rebaked. Folded into the same PR (#602) since both are "rocker hand
passes through the guitar."
