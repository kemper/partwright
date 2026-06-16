---
date: "2026-06-13T13:55:00Z"
task: "feat: add diversity axes to the figure builder + diversify the catalog"
pr: 641
areas: [renderer, tooling, ci, agents]
cost: medium
---

## Liked / Worked
- `model:preview` component/genus stats were the workhorse — they caught the
  thin-box-braid fragmentation (48 components), the coils-displacement pinching
  the afro shell, and let me tune every new hair style fast without a browser
  round-trip. The `compare` contact-sheet tool was perfect for showing the user
  three variation sheets (skin/face/hair) to approve direction before any
  catalog work.
- Byte-identical-at-defaults discipline paid off: re-baking six existing
  catalog figures with only a palette skin change came back `componentCount: 1`
  with identical geometry, exactly as the unit probes predicted — diversifying
  the existing catalog was low-risk because of it.

## Lacked
- `model:preview` (headless manifold) and the browser bake disagree on
  `componentCount`. The cornrows runner was `1` headless but `2`–`4` in the
  browser bake — cords floating off the narrow ellipsoid sides that the headless
  mesher bridged. I burned ~3 bake cycles (~75s each, xvfb) chasing this before
  realizing headless is NOT authoritative for catalog component counts. Nothing
  in CLAUDE.md warns that the two meshers diverge on near-threshold geometry.

## Learned
- **The catalog source of truth is the browser bake, not `model:preview`.** For
  any figure with thin/proud features (cords, braids, displaced textures),
  verify `componentCount` via `build-catalog-entry.cjs`, not just headless.
- Placing relief features (cornrows) at a fixed *average* head radius lets them
  float off the narrow axes of the head ellipsoid; projecting onto the actual
  ellipsoid surface (inverse-radius `1/sqrt((d/a)^2…)`) keeps them half-embedded
  everywhere and weld-solid. Generic SDF-on-ellipsoid lesson, undocumented.
- Carving shallow parting channels between close cords explodes genus (handles)
  and tips the bake multi-component; standing cords proud and letting the
  *valleys* read as partings is both cleaner topology and better-looking.

## Longed for
- A note in CLAUDE.md's `model:preview` section: "headless `componentCount` can
  under-report vs the browser bake for near-threshold thin features — verify
  catalog entries in the browser bake." Would have saved the ~3 bake cycles.
- A way for an agent to trigger `pr-checks` on a bot-opened PR. This PR's
  `pull_request` events never dispatched pr-checks (bot-attributed opened +
  bot-authenticated git remote → GitHub suppresses the workflow), while other
  PRs in the repo got it. pr-checks has no `workflow_dispatch`, so I could not
  get the e2e shards to run at all — only a human reopen/push from their own
  account can. Either a `workflow_dispatch` on pr-checks.yml, or a documented
  "reopen from your account to kick CI" note for these sessions, would close the
  gap. I substituted by running the relevant e2e specs locally (25/25 green).
