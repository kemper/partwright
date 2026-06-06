---
date: 2026-06-06
branch: claude/busy-faraday-dY8jN
files_changed:
  - src/ui/popoverMenu.ts
  - src/ui/layout.ts
  - src/ui/toolbar.ts
  - src/main.ts
  - src/annotations/annotateUI.ts
  - src/color/paintUI.ts
  - src/color/imagePaintUI.ts
  - src/color/voxelPaintUI.ts
  - src/ui/simplifyUI.ts
  - src/ui/surfaceModal.ts
  - src/ui/resizeModal.ts
  - tests/viewport-toolbar-groups.spec.ts
  - tests/paint-controls-extended.spec.ts
---

## Human

The interactive view has grown to many buttons/features. Should they be grouped
so people open a group and pick a sub-item, keeping few buttons visible while
keeping usability/discoverability high? Wanted recommendations, then: "implement
what you proposed and I'll test the experience. Make a PR."

## Assistant

Inventoried the live UI first (~130–140 controls). The crowding was concentrated
in the **viewport overlay bar**: a flat row of ~16 buttons that grew every time a
feature module injected its own toggle. Recommended a three-tier model rather than
"nest everything": a few always-visible primaries, labelled group popovers (named,
not a generic "⋯ More", so contents are predictable), and the command palette as
the flat searchable safety net that makes hiding things cheap.

Implemented exactly that for the viewport bar:

- **`popoverMenu.ts`** — promoted the Import/Export dropdown helpers
  (`createMenuSectionHeader`/`createMenuDivider`) out of `toolbar.ts` into a shared
  module, and added `createPopoverGroup` (a labelled flyout with single-open
  coordination, click-outside, Escape) plus `viewportToolsMount`.
- **View / Inspect / Tools** popovers in `createClipControls`. View = display
  prefs (edges/grid/dims/lock, closeOnSelect off so you can flip several);
  Inspect = measure + cross-section; Tools = the mutate/decorate tools.
- **Injection contract:** the tool modules already received a `controlsContainer`
  and derived their floating-panel host from `controlsContainer.parentElement`, so
  I kept passing `clipControls` (host stays correct) but redirected just the
  *button* into `#viewport-tools-menu` via `viewportToolsMount`. Surface/Resize
  self-mount, so they target the tools menu directly now.

Key decision: **Customize and Relief stay top-level**, not in Tools. They're
contextual *primaries* — hidden until relevant (params declared / relief session),
and when shown they're a strong discoverability signal. Burying them also broke
their visibility-asserting tests, which confirmed the call.

Tests were safe because the suite drives these buttons with `dispatchEvent('click')`
(ignores visibility), so nesting in collapsed popovers didn't break them. Only one
visibility assertion needed updating (edges/grid now open the View popover first),
plus a new golden-path spec. Registered the previously palette-less viewport tools
(Measure, Cross Section, Paint, Palette, Image, Annotate, Quality, Customize) as
⌘K commands so the grouping stays discoverable.

This is an evaluation build — left per-tool "active" indication on the group
buttons as a noted follow-up; the group highlights its open state for now.
