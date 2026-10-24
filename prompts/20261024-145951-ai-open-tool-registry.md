---
session: "01BsPPSVZ2oFGFXTxRyBtu1M"
timestamp: "2026-10-24T14:59:51Z"
tools: [subagent, git-worktree, playwright]
---

## Human

it would be cool if AIs could drive the partwright app and answer questions (even making tool modals appear that the user can then take control over with)

(Delegated as PR4 of tracking issue #1085: a leaf tool registry, prefilled ToolSpecs for the main panels, the `openTool` / `getUiState` API + AI tools, docs and tests.)

## Assistant

## Key decisions

**A leaf `src/ui/toolRegistry.ts` owns the contract.** `ToolSpec {id, title, prefillSchema?, open(prefill, ctx), getState?, isOpen, close?}` plus `registerTool / listTools / getTool / getOpenTool / openTool`. It imports only the (also leaf) viewport-panel registry, so every panel module can register into it without a cycle (`lint:deps` stays clean). Each panel registers its spec next to its palette command, and the palette's tool commands now call the registry opener instead of `.click()`-ing a hidden toolbar button — so palette, toolbar and API share one opener.

**Two-stage validation.** The registry checks a small JSON-able prefill schema first (types, enums, fixed ranges, unknown keys rejected at every level that declares fields, colours normalized to `[r,g,b]`). Model-dependent ranges (surface sliders scale with the model size, simplify targets depend on the base triangle count) are checked by the opener against the live control's own bounds, with an error that states the range for *this* model. Openers validate before tearing down an already-open panel, so a rejected prefill never destroys the user's work-in-progress panel.

**Never applies.** Every opener only stages values and previews (the same live preview a slider drag triggers); Apply / Convert / Detect / Save stay user clicks. The character creator opens a handed-in spec *unbuilt* (no editor overwrite) with an explicit Preview button.

**Silent programmatic opens.** Instead of threading a `silent` flag through every opener, `runWithSilentPanelOpen(fn)` in the viewport-panel registry makes any panel opened synchronously inside it skip the AI panel's step-aside listener. The registry wraps AI/API opens in it, so the chat stays next to the tool it just opened.

**State reads mirror prefill keys.** `getState()` returns the same keys a prefill takes, so `getUiState().toolState` shows exactly what the user tweaked after a hand-off. `modeExclusion` gained optional `isActive` probes + `getActiveMode()`, and `modalShell` exposes the open modal's title, for `getUiState().mode` / `.openModal`.

**AI tools.** `openTool` / `closeTool` sit in a new `UI_GATED` set (offered on every non-plan turn, not model-changing, not retried); `getUiState` is always-available, plan-mode and retry-safe. The `openTool` id enum and a per-tool prefill-key list are generated from the live registry when the tool list is built, so new panels reach the model without editing `tools.ts`; the `prefill` arg stays a free-form object (Gemini-safe).

**Scope.** Prefill support for surface, paint, resize, place, quality, character creator, convert-to-code, detect-parts, measure and annotate; print and cross-section are registered without prefill. Remaining panels (image paint, palette, customize, voxel studio, export dialogs, settings focus, relief/voxel import wizards) are left for the follow-up.
