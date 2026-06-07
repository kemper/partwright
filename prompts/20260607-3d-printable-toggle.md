---
session: "8dTkz"
timestamp: "2026-06-07T00:00:00Z"
model: claude-opus-4-8
tools: [subagent, playwright]
---

## Human

In the AI panel, add a button — selected by default — that says something like
"3D printable". Make it work like the Plan button, but instead of changing the
flow, inject extra instructions into the prompt telling the model to make the
model as good for 3D printing as possible (flat base that fits the build plate,
not too many floating components, walls that grow by ~45° rather than 90° so
they don't need supports, etc.). Recommend any other print-friendly tips worth
including. Implement it, select it by default, open a PR. Ask questions if needed.

## Assistant

## Key decisions

**Modeled on the Plan pill, but a prompt-injection toggle — not a flow gate.**
The Plan pill (`planFirst`) empties the tool list and replaces the system
suffix. The user asked for the *opposite* effect: keep all tools, just add
guidance. So the new `printOptimized` toggle injects a guidance block into the
per-turn system suffix and gates nothing — it composes with every other toggle.
Added it to the `ChatToggles` interface and threaded it through all eight
settings touch-points (three presets, `cloneToggles`, `applyPreset`,
`setToggles`, `mergeWithDefaults`), so old localStorage records pick up the new
default via the `?? DEFAULT` merge.

**Default ON in every preset.** The user wants it selected by default, so
`printOptimized: true` ships in `minimal`/`standard`/`full`. `mergeWithDefaults`
backfills `true` for sessions saved before this field existed.

**Where the guidance is injected.** `toggleSuffix()` in `systemPrompt.ts`. The
suffix is regenerated every turn, so the guidance is live and the user can flip
it mid-conversation. Injected in *both* branches: the normal capabilities suffix
AND the plan-mode suffix (when Plan + 3D-printable are both on, the plan itself
becomes print-aware). Pulled the text into a `printableGuidance()` helper so the
two call sites can't drift.

**The guidance content.** Beyond the user's three (flat base, ≤45° overhangs,
no floating islands) I added the high-value FDM rules an AI authoring geometry
should bake in: chamfer the bottom edge instead of filleting it (a base fillet
curls into a thin overhang); short unsupported bridges (<~5 units); minimum
feature sizes (~1-unit walls, ~0.4-unit detail = nozzle-width floors);
watertight single manifold / avoid sealed cavities; low center of mass so the
print doesn't tip; ~0.2–0.4-unit clearances for mating/moving parts. Anchored
the thresholds with "treat 1 unit ≈ 1 mm" since app units are nominal. Framed it
as "bake into geometry, don't recite," and told the model to build the printable
interpretation + note the trade-off when a request inherently fights
printability — so the toggle doesn't make it refuse floating-shape requests.

**Naming.** Field is `printOptimized` (not `printable`) to avoid colliding with
the existing viewport printability pill / `computePrintability`, which is a
different concept (live structural status, not an AI-guidance toggle).

**Verification.** Build + unit green. Manually confirmed in the browser (the
pill renders green/ON by default next to Plan). Added e2e coverage in
`smoke.spec.ts`: pill in the tooltip array, a default-ON + flip-off assertion,
and a `page.evaluate` check that `toggleSuffix` contains the guidance when on and
omits it when off.

## Follow-up: system-prompt preview bubble

The user couldn't tell the guidance was being used — the system prompt is never
rendered in the chat transcript. Rather than just explain it, they asked for a
collapsible "System prompt" bubble (like the thinking bubbles) pinned before the
first message, expandable to read what's sent.

- **Faithful, not reconstructed.** Extracted the provider/override/local-tier
  dispatch that built `systemPrompt` inside `chatLoop.runTurn` into an exported
  `buildActiveSystemPrompt(toggles)`; `runTurn` now calls it, and the panel calls
  the *same* function so the bubble shows exactly what the model gets (base
  prompt + `toggleSuffix`). Avoided a `systemPrompt.ts → local.ts` import cycle
  by housing the helper in `chatLoop.ts` (which already imports `resolveLocalModel`
  and the builders) — the panel already depends on `chatLoop`, so no new edge.
- **Bubble UI** mirrors `renderThinkingBox` (`<details>/<summary>/<pre>`) in amber
  to read as a distinct category. Pinned at the very top of `renderTranscript`
  (above the empty state too, so a fresh chat can preview). Body fills async
  because the cloud prompt awaits the fetch-once-cached `ai.md`; a `seq` guard
  stops a stale fill from clobbering a newer bubble. Open state persists across
  the transcript's `replaceChildren()` re-renders via a module flag.
- **Live updates on pill flips.** Pills only re-render the toggle strip, not the
  transcript, so `applyToggleChange` (the single choke point) now also calls
  `refreshSystemPromptBubble()` to re-fill the body in place.
- Added a golden-path smoke test: bubble visible, expands to the guidance, and
  flipping the pill off drops the guidance from the live preview.
