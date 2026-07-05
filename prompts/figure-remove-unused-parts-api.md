---
date: 2026-06-25
branch: claude/admiring-goodall-1tlwna
files_changed:
  - src/geometry/sdfFigure.ts
  - public/ai/figure.md
---

## Human

"Is there anything else in this PR that is unused cruft that we could cleanup?"

## Assistant

Audited the PR's additions for unused surface. `noUnusedLocals: true` already
guarantees no dead internal functions/locals (typecheck passes), and knip flagged
nothing from this PR, so the only thing that can hide is a public namespace method
wired in but never really called — caught by semantic review, not the linters.

Found one: **`F.parts(rig)`** → `{ torso, neck, head, arms, hands, legs, feet }`.
It's a struct-wrapper over `F.torso`/`F.neck`/`F.head`/`F.arms`/`F.hands`/`F.legs`/
`F.feet`, which all ALREADY exist as top-level builders. Zero callers — no example,
no test; the noble lady's choker conforms to `F.neck(rig)` directly. It added no
capability, so I removed it (interface decl + namespace entry + the figure.md
section, which now just teaches "conform to the body part it wraps, e.g.
`surface: F.neck(rig)`").

Kept `F.sharedSolid` and flagged it to the user: it also has no bundled-figure
caller, but it's a deliberate agent-facing *verification* primitive (assert an
accessory is clear of a limb while authoring — necklace-through-gown,
scabbard-through-leg, not just belts), cheap and self-contained, and part of the
documented invariant battery referenced by #853. Left for the user to overrule.

Verified: typecheck clean, figure unit tests pass.
