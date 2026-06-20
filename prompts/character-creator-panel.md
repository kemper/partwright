---
date: 2026-06-20
branch: claude/affectionate-noether-q2ycko
files_changed:
  - src/figure/characterSpec.ts
  - src/figure/characterCodegen.ts
  - src/ui/characterCreatorPanel.ts
  - src/config/appConfig.ts
  - src/ui/advancedSettingsModal.tsx
  - src/diagnostics/errorLog.ts
  - src/main.ts
  - public/ai.md
  - public/ai/figure.md
  - tests/unit/characterCodegen.test.ts
  - tests/character-creator.spec.ts
---

## Human

After a product review of opportunities for the app, the user picked the
"Character Creator" direction — a no-code GUI over the SDF figure system — and
said "let's explore that." Through follow-up choices they scoped the first
version: a floating tool panel, presets PLUS raw joint sliders, output as
editable code with an embedded spec, built as a full MVP (not a prototype).

## Assistant

The figure system (`src/geometry/sdfFigure.ts`) is huge but reachable only by
hand-writing the canonical `F.rig → parts → weld → label → union → build`
recipe. The MVP turns that recipe into a panel of sliders/dropdowns so non-coders
can drive the app's deepest capability.

Key design decisions:

- **A serialisable `CharacterSpec` is the single source of truth** (body, pose,
  face, hair, clothing, colours). The panel edits it; `specToCode(spec)` turns it
  into self-contained figure code. Keeping the spec separate from the codegen made
  the generator pure and unit-testable, and let the panel rebuild wholesale on a
  preset swap without threading setters into every widget.
- **Output is editable code with the spec embedded as a `// @character v1 {json}`
  header.** This is the round-trip mechanism: re-opening the panel decodes the
  header to restore every control, while the body stays ordinary hand-editable
  figure code (power users can drop into it anytime). `normalizeSpec` deep-merges
  over defaults so a partial/older spec still loads.
- **Paint is declared in-code via `api.paint.label(...)`**, not a separate
  `paintByLabels` pass — so colours persist with the saved version and round-trip
  for free. I had to also paint the auto-generated `lids` and `sole` labels
  (emitted by `F.face.eyes` / `F.clothing.shoes`) or they render grey.
- **Every enum mirrors the real `assertEnum` lists**, verified against
  `sdfFigure.ts` directly — the exploration's first-pass guesses were wrong in
  several places (top has no `collar`/`tight`; pants length is `full|briefs` not
  `shorts|knee`; the knee joint is `lowerLegL` not `kneeL`; gaze is `center` not
  `forward`; `head` takes `faceShape` not `shape`; lids has no `round`). I caught
  these by generating sample specs and running `model:preview` / `figure:smoke`
  before building any UI — the empirical loop paid for itself.
- **Pose = named presets that seed the joint sliders**, which then layer raw FK
  edits (arms/legs symmetric, head turn/tilt, lean). Presets avoid the documented
  extreme-angle interpenetration while still giving full control.
- **Parity (per CLAUDE.md): `partwright.buildCharacter(spec, {save})`** is the
  console twin (same engine as the panel), with a `help()` entry and docs in
  `ai.md` + `figure.md`. The preview debounce is an `appConfig` knob surfaced in
  advanced settings (figure rebuilds are heavy, so it defaults higher than the
  surface one). Auto-preview on open is gated so it can't clobber unsaved work.

Verified: 11 codegen unit tests, an e2e golden path (API build round-trip +
panel preset→save), and a real-browser screenshot of the panel building a chibi.
All 7 presets render manifold, 1 component, with every label painted.

This is v1 of a larger arc — pure SDF-offset clothing, hair fidelity, painted
brows, and a full-page Studio route are natural follow-ups.

## Follow-up — CodeQL prototype-pollution guard

CodeQL flagged `normalizeSpec`'s deep-merge: a spec can arrive from an untrusted
`// @character` header, so copying its keys into the default object could write
`__proto__`/`constructor`/`prototype`. Added a guard skipping those keys, with a
regression test asserting no pollution from a crafted spec.
