---
session: "01BFo9d6wfik7wiXfWT4h8yB"
timestamp: "2026-06-10T21:06:32Z"
model: claude-opus-4-8
---

## Human

I had a feature add a ball and joint model to the gallery. I didn't change the
default settings but 3d printed it and the ball was too large to fit. Also the
stem between the plate and ball was thin and weak. Can you fix that catalog
model?

## Assistant

## Key decisions

**Scope**: The reported failures are entirely in the *default* parameter values
of the "Ball-and-Socket Mount" catalog model — the user printed at defaults and
didn't touch the sliders. The underlying `joints.ballSocket` builder geometry is
sound, so the fix lives in the model's `api.params` defaults, not in
`src/geometry/joints.ts`. Both the canonical source (`examples/ball_socket_mount.js`)
and the gallery copy (`public/catalog/ball_socket_mount.partwright.json`, which
embeds the same code) were updated to stay in sync.

**"Ball too large to fit"** — two compounding causes:
- `openingRatio` 0.85 made the socket mouth only 11.9 mm against a 14 mm ball
  (2.1 mm radial interference) — far too much for a rigid FDM socket lip to snap
  over. Raised to **0.9** (mouth 12.6 mm → ~0.7 mm radial snap interference:
  still captive past the lip, but actually snappable).
- `clearance` (radial articulation gap) 0.15 mm is too tight once FDM
  over-extrusion / elephant-foot are accounted for, so the ball jams in the
  cavity. Raised to **0.3 mm**, matching the FDM-proven default the sibling
  `joints.hinge` already uses. Also bumped the slider `max` 0.4 → 0.5 for
  headroom above the new default.

**"Thin and weak stem"** — `stemD` 6 mm carrying a 14 mm ball on a 12 mm lever.
Raised to **8 mm**. Bending strength scales ~ d³, so 6→8 mm is ≈2.4× stronger.
Still well under the mouth-clamp limit (`openingRatio·ballD − 0.6` = 12 mm) and
the builder's `stemD/2 < openingR` guard.

**Verification**: `npm run model:preview` confirmed `isManifold: true`,
`componentCount: 2` (the two separate printed halves) with no
fusion/interpenetration warnings; volume rose 9459→9748 mm³, confirming the
thicker stem adds real material. Regenerated the catalog entry's embedded
`thumbnail` and cached `geometryData` stats by running the new code through the
real app (`partwright.runAndSave` + `exportSession`) so the gallery thumbnail
and `codeHash` aren't stale, preserving the catalog's session-identity fields
(`sessionId`/`sessionUrl`/`galleryUrl`).
