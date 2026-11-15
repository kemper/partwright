---
session: "b01bd443"
timestamp: "2026-11-15T18:35:00Z"
model: claude-opus-5-5
tools: [subagent, git-worktree]
---

## Human

Finish Stage A of image tools (#1256), stacked on #1261:
1. Relief state is per session, so the Relief Studio shows for every object
   in a session that ever made a relief, including a voxel or layered-print
   object made from the same image. Scope it to the open object, keep old
   relief sessions working, and add an e2e test (tile + voxel object from one
   image; switching hides/shows the studio).
2. Shared image prep in the Image tools panel: crop, levels
   (brightness/contrast, black/white points), optional background removal.
   Reuse what the relief wizard / voxel modal have. Store it as a derived
   attachment (preferred) or as a prep op in the record; say why. Expose it in
   the API, help(), relief.md and an AI tool if it fits.
3. A live preview in the panel for the selected image + tool, cheap
   (≤160 px) and debounced; select-then-Open is allowed.

## Assistant

## Key decisions

**Relief-ness is decided per object.** `isReliefObject(settings, partId,
code)` (pure, in `reliefSettings.ts`): an `@image-tool` header decides by the
tool's engine (tile/silhouette/stepped/lithophane yes; voxel and layered
print no, including a layered print's `api.layeredPrint(api.image(…))` call);
otherwise the session's new `objects` list (part ids a relief was committed
into) decides; otherwise, a session marked relief before the list existed is
a **legacy** relief session and every header-less object counts, so old
sessions still open with the studio. Header-less reliefs (the
`importImageAsRelief` API, SVG reliefs) are covered by the list. Every
`isReliefSession` reader in main.ts now asks the open object instead: the
paint-colour chokepoint's relief preview, the preview-mode restore, the
studio show/hide, Import → Image → relief re-open, and
`setReliefPreviewMode`. Layer height stays session-level (the studio writes
it there); per-object layer height wasn't needed for this bug.

**The studio re-syncs from `onStateChange` on a key change** — session id |
object id | relief-ness, read from the state's `currentVersion.code` (which
`changePart` sets together with `currentPart`, so it can't be the previous
object's code). Syncing only on a key change keeps a studio the user closed
closed while they keep working on the same object.

**Prep is stored as a derived attachment**, not as a prep op in the tool
record. Every tool (relief, voxel, layered print, and the Stage B
`api.image(id)` code ops) then reads plain pixels with no prep logic of its
own, the original attachment stays, the AI sees the prepped image as an
ordinary attachment, and no record schema changes. The attachment's
description says what was done and which image it came from; its id is a hash
of the result, so the same prep twice reuses one attachment.

**Prep reuses the existing pieces.** Tone is the relief pipeline's
`preprocessRgb`; background removal uses `detectBackgroundMask` (on a
5-bit-per-channel copy, so a photo's noisy backdrop reads as one colour) to
find the backdrop, then `bgMaskFromColor` around its mean. The crop UI is the
relief wizard's drag box, extracted to `src/ui/cropBox.ts` and used by both.
Removed background is written as white at alpha 1/255: a canvas round-trip
turns fully transparent pixels black, which a flat relief tile (alpha-blind)
would print; alpha-aware consumers (voxel cutoff, relief's alpha mask, the
layered-print solver) still treat it as transparent. Output is capped at the
new `import.imagePrepMaxPx`.

**Preview uses each tool's own sampler** at a capped resolution
(`sampleImageToGrid` for relief tools, `computeImageVoxelLayout` for voxel),
so it can't drift from what the tool makes; layered print shows a tonal hint
and says the filaments are solved in its dialog. The panel previews the
unsaved prep too. The panel is now select-then-Open (double-click opens
directly); opening with unsaved prep saves the prepped copy first. Debounce
and size are App Config knobs (`ui.imageToolPreviewDebounceMs`,
`ui.imageToolPreviewMaxPx`).

**AI tool `prepImage`** is ungated (always available, no confirmation): it
only adds a copy of an attachment and makes no geometry.
