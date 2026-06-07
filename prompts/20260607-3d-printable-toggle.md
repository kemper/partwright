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
