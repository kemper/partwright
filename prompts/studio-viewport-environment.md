---
date: 2026-06-20
branch: claude/intelligent-ride-qb0w5p
files_changed:
  - src/renderer/studioEnv.ts
  - src/renderer/viewport.ts
  - src/renderer/materials.ts
  - tests/unit/studioEnv.test.ts
---

## Human

Revisit the interactive view. The current style feels too dark/vague — default
to a lighter "space" so it feels like objects are in a room. Separately, explore
making selection more direct (Tinkercad-style move, or a quick-actions menu on
select). Investigate and recommend.

After investigation the user chose two things via a decision prompt:
1. Build the "studio space" look first (selection-first quick menu deferred to a
   follow-up).
2. Of the three prototyped looks, make **Preset 3 — dark studio stage** the
   default, with a **stronger, clearly visible** contact shadow.

## Assistant

Investigated the viewport with three parallel explorations: the render/style was
a flat navy void (`#1a1a2e`), three plain white lights, no shadows/env/floor,
grid hidden by default, single cornflower-blue Phong material. The interaction
model has no per-object scene graph (always one merged mesh; "parts" are
code-level), and drag-to-move already exists as the buried Arrange mode — so I
recommended a selection-first quick-actions HUD over a global default-drag, and
splitting the visual work out as the low-risk first track.

Per the repo norm for subjective/aesthetic work, I prototyped 3 switchable looks
behind a temporary `?studio=N` gate and shipped side-by-side screenshots for the
user to pick, rather than iterating one interpretation blind.

Implementation of the chosen direction (dark studio stage default):

- New `studioEnv.ts` owns the theme-keyed look: a vertical gradient backdrop,
  floor color, env-map intensity, ACES exposure, contact-shadow strength, and a
  PBR (`MeshStandardMaterial`) model color/roughness/metalness. Dark = graded
  charcoal stage; light = soft seamless studio (so the existing light/dark toggle
  stays coherent). Default theme is already `dark`, so new users get the stage.
- `viewport.ts`: always-on now (gate removed). Adds RoomEnvironment IBL via
  PMREM, ACES tone mapping, a floor plane + a transparent `ShadowMaterial`
  shadow-catcher (so shadow darkness is tunable independent of floor color), and
  a shadowed key light whose shadow frustum is sized to the model in
  `frameModel`. `applyStudioTheme` re-skins everything (and the live mesh
  material) on theme flip. The env map is rebuilt on `webglcontextrestored`
  since it's a GPU texture lost with the context.
- Kept light-rig *intensities* reading from `appConfig.renderer` (not baked into
  the preset) so the existing advanced-settings knobs aren't orphaned — the env
  map + gradient + floor + shadow carry the "stage" mood, not the intensities.
- Removed the now-dead `createDefaultMaterial` (old flat Phong) per the
  dead-export rule.

Verified both themes in the browser (screenshots posted), plus `tsc`, unit tier,
`lint:deps`, production build, and a new `studioEnv` unit test.

Deferred (tracked for follow-up): the selection-first quick-actions HUD
(click a model/part → Move/Rotate/Resize/Paint menu wired to existing ops).
