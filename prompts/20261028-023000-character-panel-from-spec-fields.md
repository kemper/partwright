---
session: "01MG8C81"
timestamp: "2026-10-28T02:30:00Z"
tools: [playwright]
---

## Human

work on #1083 to generate the panel from SPEC_FIELDS

## Assistant

## Key decisions

**Metadata lives on SPEC_FIELDS itself.** Each field gets an optional `ui`:
- label, section, coarse `order`;
- soft `slider` range (the hard bounds stay the field's own min/max, with a
  `hard` override for open-ended fields such as height, ball size and seed);
- `options` labels (unlabelled values are humanized, so a new enum value shows
  up readable) and `control: 'segmented'`;
- `when` visibility predicates, `mirror` paths (one slider drives both arms),
  an `onSet` effect (size a fresh ball);
- nullable handling: `nullShows` for the effective value, `reset` groups for a
  single "back to default" button.

A field the panel doesn't show must say so with `{ hidden: 'why' }`. All of it
is pure data plus closures, so `characterSpec.ts` stays DOM-free.

**Layout is a pure module** (`src/figure/characterPanelLayout.ts`). It turns the
tree into ordered, visibility-filtered sections (tree order within a section,
`ui.order` as a coarse bucket) and holds the get/set/apply helpers. That makes
the whole panel structure unit-testable in node.

**The panel renders generically.** Four bespoke controls stay hand-written:
Style (applies style defaults), Head size (a multiplier on the current head
scale), Pose preset, and the print list. They're keyed by `ui.custom` in a
`Record<CustomControlId, …>`, so TypeScript forces a renderer for each id.
Re-rendering is generic too: an edit re-renders only when `layoutKey(spec)`
changes, which replaces six hand-placed `rebuild()` calls.

**Drift guards (tests/unit/characterPanelLayout.test.ts):**
- every leaf has `ui` or a hidden reason;
- shown fields are a renderable kind or custom;
- slider ranges sit inside the hard bounds;
- option and mirror keys are real;
- each custom id is used once;
- no duplicate labels within a section.

I mutation-checked the first guard: stripping `ui` from `pants.leg` fails it
with the path.

**Behaviour kept.** All 20 existing Character Creator / AI-open-tool e2e tests
pass unchanged. Visible differences:
- option values are capitalized;
- a few rows reorder within their section;
- `pants.leg` gets its first control ("Leg cut"), which is the point;
- `hair.preset` shows as "Captured hairdo" for captured hair;
- the Sole reset shows disabled at its default, matching the eye-layout reset.

I moved Hair back next to Skin in the colours tree so the colour list reads as
before. Added an e2e test: Leg cut (UI metadata only) edits the spec into
`leg: 'cargo'`, and a `when` rule reveals Shorts hem without any panel code.

## Assistant

## Review follow-up

The work-reviewer found nothing blocking. Fixes:

**`layoutKey` now covers derived display state, not just which controls are
visible.** It also changes when:
- a reset group flips between default and set (the Sole and eye-layout resets
  stayed disabled after an edit);
- a null field's displayed value moves (a null Sole swatch kept showing the
  old footwear colour);
- a segmented value changes. Segmented buttons draw their pressed state at
  render time, and they only refreshed because today's three segmented fields
  happen to show or hide other controls. A new segmented field with no
  dependants would have gone stale. Putting the value in the key fixes it
  generically.

**Reset groups** are built from every member, not just the visible ones.

**Keyboard focus** returns to the same field after a re-render. Rows carry
`data-path`; arrowing through a `<select>` fires `change` on each step.

**Gaze.** `middle` is an alias of `center` in sdfFigure's `GAZE_PRESETS`, so
the dropdown labels it "Middle (= center)". This also corrects my #1065
randomizer comment, which wrongly called it cross-eyed.
