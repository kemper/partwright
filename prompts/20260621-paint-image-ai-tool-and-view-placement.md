---
session: "483euo"
timestamp: "2026-06-21T01:50:00Z"
model: claude-opus-4-8
tools: [playwright]
---

## Human

An AI chat session struggled badly to paint a Garfield/"LASAGNA" shirt graphic
onto a figure — it produced two formless orange blobs (screenshot attached). The
user asked the AI for feedback; it diagnosed "no bridge between raster images and
surface paint" and asked for a `paintDecal(image, {surface, point, size})` tool,
an engrave "paint mode", region-scoped relief, and project-from-direction paint
modes.

## Assistant

## Key decisions

**The capability already existed — the gap was AI-tool parity, not geometry.**
`window.partwright.paintImage` (→ `stampImageProgrammatic` → `stampImageOntoMesh`)
already does orthographic image-projection onto the mesh as per-triangle paint:
tangent frame, back-face skip, depth slab against thin walls, background removal,
smooth-subdivided footprint. It was documented in ai.md/colors.md. But it was
**never wired into `src/ai/tools.ts`** — not in ALL_TOOLS, no schema, no dispatch,
not in PAINT_GATED — so the in-app chat agent literally had no tool to call it and
fell back to `paintInBox`/`paintNear` (solid-colour regions) → blobs. This is the
exact UI↔JS-API parity gap CLAUDE.md warns about.

**Scope (confirmed with the user): tool wiring + a placement helper, named
`paintImage`** (matches the existing console method — one name across surfaces —
rather than the AI's suggested `paintDecal`). Skipped the engrave-paint-mode and
region-relief asks as separate larger work.

**The real pain point was placement, not the stamp.** The agent had to
hand-compute `at` (a surface point) and `normal` (projection axis); that's where
it gave up. So I added a `view` ('front'|'back'|'left'|'right'|'top'|'bottom')
placement mode that auto-resolves both: the view fixes the projection normal
(front=-Y, etc., per multiview's STANDARD_VIEWS) and a ray-cast toward the model
centre finds the surface anchor. An optional `label` centres the projection on an
`api.label` region and auto-sizes the decal to its footprint when `size` is
omitted. Explicit `at`+`normal` still work unchanged (back-compat).

**Kept the placement math in a new pure module** `src/color/imagePaintPlacement.ts`
(`resolveImageStampPlacement`) — dependency-free (own Möller–Trumbore ray sweep,
no THREE) so it unit-tests in the node tier and keeps the heavy logic out of the
NUL-byte `main.ts`. `main.ts`'s `paintImage` just resolves the label→triangle set
from `currentLabelMap`, calls the resolver, then the existing stamp path.

**AI tool image source:** the tool takes `imageRef` (1-based index into the
session reference images the user attached — same list `getReferenceImages`
shows) or `imageUrl`; the dispatch resolves `imageRef` via `api.getImages()` →
`src` data URL before calling `paintImage`. The schema description steers the
model to use this for logos/graphics/text and explicitly warns off the
solid-colour tools.

## Verification

- typecheck clean; 1566 unit tests pass (incl. 8 new placement tests); madge
  no-cycles gate green.
- Browser: ran a scratch spec that built a torso box, generated a transparent-bg
  "LASAGNA" + disc graphic, called `paintImage({view:'front', size:34})`, and
  screenshotted the front view — the disc and **legible** lettering projected
  cleanly with the background dropped (17k triangles painted). Posted the PNG in
  chat. Scratch spec deleted before commit.

## Files

- `src/color/imagePaintPlacement.ts` (new) — pure `resolveImageStampPlacement`.
- `tests/unit/imagePaintPlacement.test.ts` (new).
- `src/main.ts` — `paintImage` accepts `view`/`label`, optional `at`/`normal`/
  `size`; resolves placement; help() table updated.
- `src/ai/tools.ts` — `paintImage` schema + dispatch + PAINT_GATED +
  PART_TARGETABLE_TOOLS.
- `public/ai.md`, `public/ai/colors.md` — documented view/label placement.
