---
session: "1kdce9"
timestamp: "2026-06-09T22:05:00Z"
model: claude-opus-4-8
tools: [playwright, vitest]
sequence: 7
---

## Human

Phase 5 of surface-textures-as-code (stacked on phase 4): per-region textures —
texture only part of the model, so different regions can carry different
textures.

## Assistant

## Key decisions

**`api.surface.<id>({ region })` resolves to a patch apply.** The sandbox builds
a RegionDescriptor from a `region` selector that mirrors `api.paint.*`: a label
name (string / `{label}`), `{box}`, `{slab}`, or `{cylinder}` (exactly one). The
descriptor rides on the SurfaceOp; the main thread resolves it to a triangle set
and `computeChain` routes to the `apply*Patch` variant instead of the whole-model
modifier.

**Region resolution happens per-op against the op's INPUT mesh, on the main
thread.** computeChain gained a `RegionResolver` callback (the resolver lives in
main.ts, which owns `resolveDescriptorTriangles` + the label map). Resolving
against each op's input mesh keeps geometric selectors (box/slab/cylinder) exact
even when chained after a prior texture that subdivided the mesh.

**byLabel is guarded, not silently wrong.** A `byLabel` region depends on the
run's label map, whose triangle ids are only valid on the un-textured base. So
the resolver throws an actionable error if a byLabel region would run on an
already-subdivided mesh (i.e. it's not the first surface op) — telling the user to
reorder or use a geometric selector. Single-region byLabel (the common case) and
geometric multi-region chaining both work; the broken case fails loudly.

**Two correctness fixes caught by reasoning, not types:**
- `prefixKey` (the memo key) omitted `region`, so a region change wouldn't
  re-key the cache — added `region` to the serialized chain.
- `currentLabelMap` is set by the run handler *after* applySurfaceTextures, so
  byLabel regions would resolve against the previous run's labels — the resolver
  factory now sets it early (idempotent with the later assignment).

**Scope boundary:** region is code-authored (write `api.surface.knit({region})`
in runAndSave). The phase-4 `surfaceTexture` tool / panel stay whole-model and
reject a `region` option with a message pointing to code — because the panel's
raw-triangle selection isn't a durable descriptor, and the tool's codegen only
serializes scalars.

## Verification

`tests/surface-region.spec.ts`: a box region produces base < region < whole-model
triangle counts (proves it's a patch, not whole-model); a `region: 'body'` label
textures the labeled region; a two-selector region errors. Browser-confirmed —
top hemisphere knit, bottom smooth (screenshot). All 8 surface e2e + unit tier +
build + lint:deps/consistency/deadcode green.
