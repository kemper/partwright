---
date: 2026-06-21
branch: claude/admiring-goodall-1tlwna
files_changed:
  - src/geometry/sdfFigure.ts
  - tests/unit/figureAttachment.test.ts
  - public/ai/figure.md
---

## Human

Direction-4 exploration: build a figure accessory/attachment system (clothing,
armor, swords, hats, glasses, makeup, …). Decisions locked: validate the taxonomy
with one item per attachment MODE; author code-first via `F.*` helpers + new rig
frames (panel/spec later); every accessory fuses into ONE printable piece.
File a tracking issue, then start building — produce high-quality previews of each
item and review the quality myself.

## Assistant

This commit is Phase 0 — the attachment LAYER the items build on. Filed tracking
issue #828 with the Phase 0 + 7-item checklist.

The rig already had grip/sole/face/torso frames + holdAt/placeOnHead/standOn/
placeAt verbs (held/crowned/under-foot/conformal already possible). The gap was
the body-middle: neck/waist/back/shoulder/forearm frames and the wrap/strap/hang/
face verbs. Added, mirroring the existing frame style:

- **Frames** (in `buildRig`, all spine-transformed via sPt/sDir so they track
  lean/turn like the joints; `hang` stays WORLD-down = gravity): `rig.ring.neck`
  / `rig.ring.waist` (RingFrame: center/axis/xAxis/yAxis/rx/ry/hang — the
  elliptical body cross-section), `rig.shoulder.L/R` (acromion), `rig.back`
  (point + outward +Y normal), `rig.forearm.L/R` (LimbFrame elbow→wrist).
- **Verbs** (on the figure namespace + FigureNamespace interface): `F.ring`
  (closed elliptical band swept from capsules so it conforms to the non-circular
  cross-section; rides clearance+tube OUTSIDE the surface), `F.ringPoint`
  (az 0=front/90=left/−90=right — seat a buckle or hang a scabbard), `F.strap`
  (forward-bowed band between two anchors — bandolier/sash), `F.hangFrom`
  (gravity analog of holdAt — dangle a node below a point), `F.onFace` (eye/bridge/
  temple points + forward/up/lateral axes for glasses/masks).

Exposed all five in `__figureTestables__`; added `tests/unit/figureAttachment.test.ts`
(12 tests: frame geometry, spine-lean tracking, ringPoint azimuth mapping, band
bounds, strap span, hangFrom drop, onFace handedness, namespace wiring). A test
caught my own off-by-tube assumption — the band centre-line rides at
rx+clearance+tube so its inner edge touches the surface, outer edge is +2·tube.

Validated the foundation headlessly with the first item, **eyeglasses** (Perched
mode): manifold, 1 component. Key lesson re-confirmed for thin accessory features:
they fragment on the coarse march and the `detail` REFINE pass frays thin tubes
(the hands-spike failure) — so route thin arms to HUG/rest on the body surface
(supported), keep them print-chunky (≳1.3× edgeLength), and prefer a finer global
edgeLength over a refine sphere. The principled per-region fine-march for thin
accessories is the bigger Phase-0 generalization tracked in #828.

The 7 item snippets are validation previews in gitignored `.plans/accessories/`;
the committed deliverable is the reusable attachment layer.
