---
session: "01BsPPSVZ2oFGFXTxRyBtu1M"
timestamp: "2026-10-23T19:36:28Z"
tools: [subagent, git-worktree, vite-node, model-preview, playwright]
---

## Human

Do all remaining follow-ups of #1059: expose the figure library's #1055
primitives (head sink, per-hand cup + hand scale, bead eyes, bold brows, shag
and captured hair knobs, collar/cuff trim, striped socks, toy cleated shoes,
garment lettering, knee-length shorts) through the CharacterSpec, the codegen,
the Character Creator panel (collapsed Details / Print sections, eye-height box,
eye-layout reset, 44 px touch targets) and the buildCharacter AI tool + docs,
keeping old specs byte-identical, then rebuild the Tsubasa Funko from a spec
only and score it against the hand-written v7.

## Assistant

## Key decisions

**Spec version: additive v2 fields, no v3.** Every new field has a default
that reproduces the code the spec generated before it existed, and normalizeSpec
already deep-merges partial specs over the defaults, so no migration step is
needed. Byte-identity below the header is pinned by a new fixture
(tests/unit/fixtures/characterV2Code.json, 17 specs captured from the
pre-change codegen) next to the existing v1 fixture. The header JSON itself
grows the new defaulted fields — the same "identical below the header"
contract the v1→v2 migration already used.

**Library extension only where the spec needed it.** Pants got `length:
'shorts'` + `hem`: the full pants intersected with a seat half-space and a
disc slab along each thigh bone (the trimZone construction), so the cut is
perpendicular to a posed leg instead of the v7 hand-written world-Z box.
Everything else maps onto existing #1055 options.

**Print units are chest half-widths** (`rig.r.chestX`) for size and x/z
offsets so a print scales with the figure; each print paints its own colour
under its own label (`print1`, `print2`, …). Trim uses `F.garment.top` only
when trim or prints are on, so plain tops keep the old one-line
`F.clothing.top` call. Sock stripes share the top `stripeSpan` via trimZone
`stripes`. Bead-eye radius stays `eyeSize × 0.16 r.head`, so switching eye
style keeps the eye size; `applyStyle('funko')` now picks bead eyes, a 0.4
head sink and mitten hands.

**Added `face.jaw/chin/cheek` and `body.mittens`** beyond the issue list: the
spec-only Tsubasa scored 0.884 / 0.891 until the head-shape knobs were
exposed (the lower face was 10–15 % narrow); with them it scores 0.914 front /
0.899 back (shag, 1.17 k chars) vs the hand-written v7's 0.912 / 0.911; the
captured-hair variant scores 0.896 / 0.875.

**Panel:** two collapsible `<details>` groups ("Face & body details", "Kit
details") plus a "Print" group with per-print cards; their open state survives
the wholesale control rebuilds. The number box widened to w-14; selects,
number boxes, sliders, swatches, checkboxes rows and preset buttons grow to
44 px below the md breakpoint. Save now clears a pending debounced preview —
the new e2e golden path caught it firing mid-save and cancelling the save's
build.

**Also fixed** the stale shag-crown description (7 spikes round the crown,
sized by crownSize) the AI reads from the spec schema.
