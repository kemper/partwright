---
session: "exbellnkv"
timestamp: "2026-06-05T20:23:02Z"
model: claude-opus-4-8
tools: [explore, playwright]
---

## Human

When curvature quality is selected from the quality menu it takes effect
instantly. I'm ok with that as an auto-preview operation but I want there to
be an apply button for those changes. That could be awkward with that sharing
the menu with simplify/enhance as it says "Save as version." Maybe I should
have an apply for both operations and also have a save as new version for both.
What do you think?

## Assistant

## Key decisions

**Pushed back on full symmetry.** Curvature quality and simplify/enhance are
different *kinds* of operation: quality is a non-destructive render *setting*
(it just re-tessellates and is already persisted as a setting), whereas
simplify/enhance produces an *ephemeral* baked mesh that only "Save as version"
can persist. Putting both buttons on both sections would make the same two
labels mean four different things. "Save as version" earns its place for
simplify/enhance because there's an ephemeral result to rescue; quality has
nothing ephemeral, so a Save-as-version there would be redundant and confusing.

Confirmed direction with the user via two questions: (1) quality gets **Apply
only**, not Save-as-version; (2) an un-applied quality change is a true preview
that **reverts on cancel/close**.

**Implementation** (`src/ui/simplifyUI.ts`, localized):
- Picking a quality radio now only *previews* — it still calls
  `saveQualityForLang` to re-render live, but no longer counts as committed.
- Added an **Apply quality** button under the radios. Enabled only while the
  previewed quality differs from the committed one (mirrors the simplify Apply's
  "no-op stays disabled" rule via `updateQualityApplyEnabled`).
- `committedQuality` is snapshotted on panel open and on each Apply. Closing the
  panel (any path — ×, Escape, toggle, forceDeactivate all route through
  `closePanel`) calls `revertQualityPreview`, which restores the committed
  quality if the live preview drifted. Language switches re-baseline the
  committed snapshot since the engine silently swaps in that language's default.

**Tests.** The existing quality specs encoded the old instant-persist behavior
(pick a preset, close without Apply, expect it to stick), so they were updated
to click Apply quality before closing. Added a new test asserting that closing
without Apply reverts the preview to the committed Highest default.
