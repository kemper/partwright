---
session: "sharpbell"
timestamp: "2026-06-23T14:00:00Z"
sequence: 8
---

## Human

I don't like that particular attempt at producing tabby stripes. I was thinking
maybe something algorithmic similar to how we produce textures only it would be
for paint or color. [...] Build option 1 and show me previews of each effect.

## Assistant

## Key decisions

Built **Option 1 from #850 — `api.paint.pattern`**, the colour twin of the
`api.surface.*` procedural *texture* system: a field evaluated per-triangle
assigns each triangle in a scope ONE palette colour, instead of displacing
geometry. Replaces the disliked hand-placed `api.paint.box` stripe slabs with
organic field-driven patterns.

**Reused the existing substrate rather than new plumbing.** Per-triangle colour
is already a persisted/exported path (`ColorRegion.perTriColors`, used by
`imagePaint`), and `src/geometry/noise.ts` already ships Perlin/fBm + a seeded
PRNG. So the only new pieces are a pure field module and a descriptor kind:

- `src/color/colorPattern.ts` (new, pure) — `computePatternColors(mesh, scope,
  spec)` → `Map<triId, rgb>`. Four fields: `stripes` (sin·axis + fBm
  domain-warp → tabby/tiger/zebra/brindle), `spots` (Worley/cellular nearest-
  feature distance → leopard/dalmatian, optional 3rd-colour rosette core),
  `patches` (low-freq fBm split into 2–3 zones → calico/cow/tortie), `gradient`
  (distance-from-centre, noise-jittered → siamese points).
- New `{ kind: 'pattern', pattern, colors, scope?, scale?, axis?, warp?,
  coverage?, seed? }` in `RegionDescriptor`, resolved in BOTH the headless
  `paintOpsResolve.ts` (→ `model:preview`) and the browser
  `resolveDescriptorTriangles` (`main.ts`), so it renders identically in CI and
  in-app. `previewModel.ts` colours per-triangle when `perTriColors` is present.
- `api.paint.pattern(...)` recorder in `manifoldJs.ts` (strict validation,
  matching the other `api.paint.*` verbs).

**`scope: 'body'` is the key ergonomic win** — it restricts the fill to an
`api.label` region, so the pattern paints the whole body/head/tail but never the
eyes/nose/muzzle (separate labels). That's the thing the box approach had to
fight with hand-tuned bounds. Verified all face labels stay nonzero.

**Printability preserved:** every triangle stays one flat palette colour (no
blending), so a pattern still maps cleanly onto filament slots.

Prototyped all four on the real cat geometry via `model:preview --palette-file`
and showed the user; stripes/spots/patches look spot-on, gradient flagged for a
possible "distance-from-nearest-extremity" refinement so the face mask darkens.

**This commit is the engine only.** Wiring it into the eval cat/dog models
(replacing the box tabby/brindle), the in-app AI tool, and `colors.md` docs
(UI↔API parity) is the follow-up, pending the user's pick on named colorways +
the gradient tweak. Tracked on #850. Typecheck + full unit tier (1588) green.
