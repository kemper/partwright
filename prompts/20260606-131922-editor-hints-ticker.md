---
session: "noethr"
timestamp: "2026-06-06T13:00:00Z"
model: claude-opus-4-8
tools: [subagent, playwright]
---

## Human

Add a feature at the top of the editor: a rolling/recurring series of "Did you
know?" hints that tell the user about app capabilities they might not discover
organically (⌘K command palette, the texture tool in the interactive view,
etc.). Each hint should have a call-to-action: clicking it navigates to the
relevant place — the catalog/ideas page if it's about those, or, if it's an
in-editor menu, switch to the interactive view and automatically open the menu
with an arrow pointing at the option. Research and create a plan, then report
back.

Follow-up decisions (via AskUserQuestion):
- Look & feel: slim rolling ticker between toolbar and session bar.
- In-editor CTA behavior: auto-open the menu/modal AND pulse a spotlight arrow.
- Persistence: shown by default; ✕ hides for the session; a permanent toggle in
  Advanced Settings.

## Assistant

## Key decisions

**Reuse over rebuild.** Two existing systems carried most of the weight:
the command registry (`src/ui/commandPalette.ts`, ~40 actions keyed by id) and
the guided-tour coachmark (`src/ui/tour.ts`, spotlight + directional arrows).
So the CTA layer is mostly *dispatch into existing actions* plus a lightweight
extracted coachmark, not new navigation plumbing.

**Data-driven hints.** `src/ui/hints/hintsData.ts` mirrors the `ideas.ts`
pattern: a flat dataset of `Hint`s, each with a discriminated-union `HintCta`:
`command` (run a registered palette action by id), `open` (the two global
overlays that aren't palette commands — command palette, shortcuts), and
`coach` (run prep commands, optionally click a popover trigger to reveal a
nested button, then pulse an arrow at a target selector). Kept dependency-free
(type-only import) so it unit-tests in the node tier.

**New reusable coachmark** (`src/ui/coachmark.ts`) instead of overloading the
tour: a non-modal pulse ring + arrow bubble that is `pointer-events:none`, so
the user can click the highlighted control *through* it. Auto-dismisses on a
timer or the first real interaction; bails (returns false) if the target is
missing or zero-size (e.g. inside a collapsed popover).

**The popover-close gotcha.** A `coach` CTA that opens the Tools popover and
arrows the Surface/Paint button inside it initially failed: opening the popover
during the CTA click let that same click keep bubbling to `document`, tripping
the popover's own click-outside handler and closing it again. Fix: defer the
whole coach sequence with `setTimeout(0)` so it runs after the click finishes
propagating. Verified in the browser (screenshot) that the Tools menu now opens
and the ✦ Surface button gets a ringed, labeled arrow.

**Visibility model.** `config.ui.editorHintsEnabled` (permanent, Advanced
Settings + `toggle-hints` command) gates mounting; a per-tab `sessionStorage`
flag (`partwright-hints-hidden`) is the ✕ "hide this session" — so a fresh tab
shows it again, honoring cross-tab isolation. Unseen hints rotate first
(`localStorage` seen-set), then cycle. Added `onConfigChange` to appConfig so
the settings toggle takes effect live, and `runCommandById` to the palette so
CTAs reuse registered actions without duplicating wiring.

**Mount point.** A stable host `#editor-hints-host` is appended to `#editor-ui`
right after the toolbar (before the session bar), so the strip sits between
them and the ticker can mount/unmount in place without disturbing layout.

Tests: `tests/unit/hintsData.test.ts` (dataset integrity + CTA ids resolve
against a mirror of the registered command set) and `tests/editor-hints.spec.ts`
(renders, rotates, ✕-dismisses, and a coach CTA pulses an arrow).
