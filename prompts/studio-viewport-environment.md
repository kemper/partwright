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

### Follow-up: CI e2e failure (window.partwright undefined)

`multipart-export.spec.ts` failed in CI (and reproduced locally): two tests read
`window.partwright` after a hard `waitForTimeout(4000)` and got `undefined`.
Root cause was a **startup-latency regression**, not a crash — measured
app-readiness jumped from ~2.85s (main) to ~6.95s (branch). The PMREM /
RoomEnvironment image-based-lighting bake is ~tens of ms on a real GPU but
~3.9s on the **software WebGL rasterizer** (SwiftShader) that CI and the
sandbox use, and it ran on the synchronous init path before `window.partwright`
attaches. A `setTimeout(0)` deferral didn't help (it fired during an `await`
gap still ahead of the attach).

Fix: detect a software rasterizer (`isSoftwareRenderer` via
`WEBGL_debug_renderer_info`) and **skip the env bake there** — software/GPU-less
users get the still-good gradient + floor + contact-shadow + direct-light PBR
fallback, while real GPUs keep the full IBL look (the bake is effectively free
there). Readiness back to ~3.2s; the failing spec passes 3/3. Unknown renderer
(privacy-restricted debug info) is treated as hardware.

### Follow-up: lighting/shadow made opt-in (user feedback)

User feedback after seeing it live: loved the space + colors, but the
image-based lighting looked too bright / washed-out (a "spotlight") and the
shadow added little. Asked for a **"Light" button in the viewport, off by
default**.

Reworked accordingly:
- **Default** is now the calm matte look — gradient backdrop + floor + matte
  PBR under the existing ambient + two directional lights. **No env reflections,
  no cast shadow.** (This also removed the `isSoftwareRenderer` gate entirely:
  with no env at startup the latency problem is gone for everyone.)
- A new **"☀ Light" viewport pill** (`#light-toggle`, off by default) toggles
  `setStudioLighting`, which builds the PMREM env on first opt-in (never at
  startup → startup stays fast, software-WebGL bake cost only paid on click) and
  enables a **mild** contact shadow (shadowStrength 0.2 dark / 0.13 light) via
  the key light's `castShadow` + the existing ShadowMaterial catcher.
- Closed UI↔JS parity: `partwright.setStudioLighting(on?)` / `isStudioLighting()`
  + help table + ai.md. New e2e `tests/studio-lighting.spec.ts` (off by default,
  toggles on/off). The env build/shadow framing was factored into
  `frameModelShadow()` so the toggle can size the shadow to the current model.
