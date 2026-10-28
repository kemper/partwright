# AI Provider Internals

Reference for per-provider implementation details. Consult when modifying `chatLoop.ts`, `gemini.ts`, `anthropic.ts`, or `openai.ts`.

## Thinking box (reasoning models)

Gemini 3 thinking models emit reasoning as `thought:true` text parts (opt-in via `generationConfig.thinkingConfig.includeThoughts`). `gemini.ts` routes them to a separate channel (`StreamResult.thinking` + `onThinking` callback) so they never bleed into the answer bubble. `chatLoop` persists them as `'thinking'` `ChatBlock`s; the panel shows a live indigo box while streaming (`renderLiveThinkingBox`), then collapses it once the next step begins. `onThinking` beats the stall watchdog so a long think doesn't trip a spurious abort. `'thinking'` blocks are display-only — no provider replays them as model text.

## Gemini thought signatures

Gemini 3+ attaches an opaque `thoughtSignature` that must be echoed back on the exact part it was received on. A missing signature on a `functionCall` part is a hard 400; a missing one on a text part silently degrades reasoning (the "Gemini stalls after thinking" symptom — model bails with a tiny `end_turn`).

In streaming, the signature can ride the `functionCall` part, the answer text part, **or a trailing part whose text is empty**. `consumeGeminiStream` captures it off any part (`pendingSignature`) and binds it to the first tool call (mandatory) or the answer text block (`textThoughtSignature` → persisted on the `ChatBlock`, replayed by `buildGeminiContents`). **Skipping empty-text parts is the classic bug here.**

## Thinking level (the 🧠 pill)

`ChatToggles.thinking` (`off` | `default` | `low` | `medium` | `high` | `xhigh` | `max`) maps per provider + model at request build time. The level semantics live in the pure module `src/ai/thinkingLevels.ts` (unit-tested in `tests/unit/thinkingLevels.test.ts`): **off** disables thinking where the model allows it (lowest effort where it can't), **default** sends no depth override, and **low…max** request an effort, clamped to the nearest level the model supports (the catalog's `reasoning_options` effort list when present):

- **Anthropic** — two wire shapes, chosen per model by `resolveAnthropicThinkingMode` (`src/ai/anthropicThinking.ts`): **budget** models (Haiku 4.5, ≤4.5 families) get `thinking: {type:'enabled', budget_tokens}` 2048/8192/16384 (advanced-settings configurable; xhigh/max use the high budget); **adaptive** models (4.6+, and the *only* accepted shape on Opus 4.7+/Sonnet 5/Opus 5.x/Fable — they 400 on `budget_tokens`) get `thinking: {type:'adaptive', display:'summarized'}` + `output_config.effort` clamped to the model's catalog effort list. The shape comes from, in order: a shape learned this session from the API's own 400 (`streamTurn` retries once and remembers it), the models.dev snapshot's `reasoning_options` (`budget_tokens` listed → budget; effort-only → adaptive), then a name heuristic (legacy families → budget, anything else → adaptive). Off sends `{type:'disabled'}` on adaptive models — except always-on ones (Opus 5.x, Fable, Mythos, or any model the API rejected `disabled` for, learned via `learnAnthropicCannotDisable`), which run adaptive at their lowest effort. Default sends nothing, except on models that think when the field is omitted (Sonnet 5+, always-on), which get the adaptive block for a visible summary. `tests/unit/anthropicThinking.test.ts` fails the weekly catalog-refresh PR if a Claude reasoning model records neither shape. `max_tokens`: budget + `answerHeadroomTokens` for budget models; the adaptive thinking ceilings (`maxOutputTokensAnthropicThinking`, `…ThinkingDeep` for xhigh/max) otherwise. Non-thinking turns use `maxOutputTokensAnthropic` (32K). Every ceiling is capped at the model's catalog output limit, so an oversized setting can't 400. The signed `thinking` block must precede each `tool_use` on replay: `collectResult` captures blocks (with `signature` + any `redacted_thinking`) into `ChatMessage.thinkingBlocks`; `assistantBlocksToApi` re-emits them first — whenever the model will think on the current request (`anthropicThinkingActive`, which includes Off on always-on models). Never replay display prose.
- **Gemini** — `off` flips `includeThoughts:false` (deliberately NOT `thinkingBudget:0`, which some Pro models reject); `default` sets `includeThoughts:true` with the model's own dynamic budget; `low/medium/high` set `includeThoughts:true` + growing `thinkingBudget` (xhigh/max = high).
- **OpenAI** — maps to `reasoning.effort` on the Responses API, sent only for reasoning models (`isReasoningModel`), clamped to the catalog's per-model effort list: `off` → `none` where listed (gpt-5.1+) else omitted; `default` omits it; e.g. gpt-5-pro only ever gets `high`. Without catalog data, xhigh needs gpt-5.2+ and max gpt-5.6+. Non-reasoning models go via Chat Completions and never see a reasoning request. The **Custom** provider sends `include_reasoning: true` above Off, plus the level as `reasoning_effort` only when the user opted in on the Custom tab.
- **Local** — no effect (`<think>` is stripped).

## Auto-continue (the ♾ pill)

`ChatToggles.autoResume` (boolean, **off by default**; on only in the explicit max-autonomy full preset) keeps the agent working until the model calls the **`finish`** sentinel tool instead of stopping at every `end_turn`. It's off in standard (the app default) and minimal because auto-continuing surprises users — the agent presses past a clarifying question instead of waiting for an answer. The default lives in `DEFAULT_TOGGLES_BY_PRESET`; turning it on (or off) writes a `custom` preset that `mergeWithDefaults` preserves (an explicit choice is never overwritten).

When **on**:
- `buildToolList` adds `finish` (gated by `AUTORESUME_GATED` in `tools.ts`); `executeTool` short-circuits it to a sentinel ack. `toggleSuffix` tells the model to call `finish` only when truly done.
- A turn ending `end_turn` without `finish` appends a synthetic user nudge (`AUTO_RESUME_PROMPT`, persisted as `ChatMessage.autoResumeNudge` → rendered as a subtle divider, not a blue bubble) and loops again. A turn that calls `finish` runs remaining tools then stops cleanly.
- Bounded by the iteration cap and spend cap. `MAX_CONSECUTIVE_AUTO_RESUMES` caps consecutive nudges that make no tool call — so a model that never calls `finish` can't loop forever.
- An empty assistant turn gets a `(no response)` placeholder so request builders don't drop it (two consecutive `user` turns → hard 400 on Anthropic). A queued human message is delivered in preference to the synthetic nudge.

Turning **off** is byte-for-byte the old behavior — no `finish` tool, no nudges, stop at each `end_turn`.

## Plan mode and question cards (the 📋 pill, `askUser`, `proposePlan`)

`ChatToggles.planFirst` makes each new request a **planning turn**:
- `buildToolList` returns only `PLAN_MODE_TOOLS`: the read-only inspection tools plus the two card tools.
- `toggleSuffix` swaps in the plan-mode instructions.
- The user's text is wrapped in `PLAN_FIRST_PREFIX` (later replies in `PLAN_REFINE_PREFIX`). Both live in `src/ai/userWords.ts`; `planTurn()` strips them for display, export and review.

- **The tool list is enforced, not just offered.** `executeAllWithRetry` (`chatLoop.ts`) refuses any call outside the turn's gated tool list with `unofferedToolMessage`. A model can still emit a tool it saw earlier in the history, which is how follow-up plans used to "just build". Pre-rename names map through `LEGACY_TOOL_ALIASES`.
- **Card tools end the turn.** `askUser` (questions with option chips; offered in every mode) and `proposePlan` (summary / steps / assumptions; plan mode only) are listed in `TURN_ENDING_TOOLS`.
  - `executeTool` validates their input and returns `CARD_TOOL_ACK`, which the transcript hides.
  - The loop then returns, like `finish` but independent of auto-continue.
  - The panel renders the call as a card (`renderAskUserCard` / `renderPlanCard` in `aiPanel.ts`).
  - Answers are written into the input and sent through `sendMessage`, so plan-mode wrapping and queueing apply.
- **Fallback for models without the card tools** (custom/local tiers trim the tool list): `planAwaitsAnswers()` in `src/ai/planReply.ts` decides from the text whether a plan reply is questions or a plan. That only changes the plan bar's wording and which button leads; Build is always offered.
- **State comes from the transcript.** `derivePendingPlan()` is true when the last typed user message is a plan request or revision. That restores the plan bar after a reload or a take-control.
  - It's re-derived on history load (not mid-turn) and after each planning turn.
  - Auto-compaction and `/compact` wait while a plan is pending, because the plan is anchored by history index.
- **Build** sends `planApprovalText(latestPlanReply(...).text)`, i.e. `[Plan approved — …]` plus the plan Markdown. The build turn runs with `planFirst: false`, so it gets the full tool list. **Discard** deletes the planning messages and restores the request in the input.

## OpenAI routing (Chat Completions vs Responses API)

`streamTurn` routes per model (gated by `isReasoningModel`):

- **Reasoning models** (`gpt-5*`, `o1/o3/o4`) → Responses API (`/v1/responses`). These reject `reasoning_effort` alongside function tools on Chat Completions. History converts to `input` shape: `message`/`function_call`/`function_call_output` items linked by `call_id`.
- **All other models** → Chat Completions (`/v1/chat/completions`). Uses `messages`/`tool_calls`/`tool` shape.

Both share dangling-tool-call repair, image handling, and review serialization. Non-tool helpers (`validateKey`/`listModels`/`summarize`) always use Chat Completions.

## Context size: tool groups, Custom endpoints and stale tool payloads

**Custom endpoint context profile** (`src/ai/customContext.ts`). The full hosted payload is about 100k tokens before the conversation starts (PREAMBLE + `ai.md` ≈ 39k, 160+ tool schemas ≈ 60k). That breaks a local model behind llama.cpp / vLLM / LM Studio / Ollama: the request is rejected, or truncated past Ollama's `num_ctx`. Each saved endpoint therefore carries a `context` profile (`SavedEndpoint.context` → `ChatToggles.customContext`):

- **Window**: the user's value, else the value detected on Connect for the selected model. `detectContextWindows` probes llama.cpp `/props` (`n_ctx`), Ollama `/api/ps` (`context_length` of loaded models), LM Studio `/api/v0/models` (`loaded_context_length` only), and `/v1/models` (vLLM `max_model_len`, `context_length`). Advertised maxima are ignored: llama.cpp's `meta.n_ctx_train` and LM Studio's `max_context_length` describe what the model could take, and an on-demand load usually uses much less. The window feeds the context meter and Auto-compact (`contextLimitFor` in `aiPanel.ts`). CLIProxyAPI bridges skip detection. The profile belongs to the endpoint, not the session, so `applySessionAiPreference` never restores it from a session snapshot.
- **Prompt tier**: Auto / Full / Medium / Slim. Medium and Slim send the local prompts (`buildMediumLocalSystemPrompt` / `buildLocalSystemPrompt`, so docs come on demand through `readDoc`) plus `REDUCED_TOOLS_NOTE`, and a compacted subset of the already-gated tool list (`MEDIUM_CUSTOM_TOOLS` ≈ 9k tokens, `SLIM_CUSTOM_TOOLS` ≈ 2.4k). Descriptions are cut to their first sentence; Slim drops parameter descriptions. Auto maps an unknown window to Full, < `ai.customSlimMaxContext` to Slim, and < `ai.customMediumMaxContext` to Medium.

**On-demand tool groups** (`src/ai/toolGroups.ts`, gated by `ai.onDemandToolGroups`, #1175). Hosted providers and Full-tier Custom endpoints don't send every tool schema from turn 0. `toolsForRequest` in `chatLoop.ts` sends `CORE_TOOLS`, the `loadTools` tool, and every *loaded* group, appended in `TOOL_GROUPS` order so the core prefix stays byte-identical. That took the default first request from ~66k tokens of tools to ~17k.

- **Loaded = read from the history** (`loadedToolGroups`): an explicit `loadTools({groups})`, a `readDoc` of a mapped topic (`DOC_TOOL_GROUPS`: `colors` → `paint`, `segmentation` → `parts`, …), or any call to a grouped tool. No stored state, so groups stay loaded for the conversation, survive reloads and the Worker hand-off, and reset after compaction drops the turns that loaded them.
- **Preloads**: the panel passes `preloadToolGroups` from main-thread session state (`sessionToolGroups` in `aiPanel.ts`; an imported mesh → `import` + `parts`). Paint regions deliberately don't preload `paint`, because the core label paint verbs create them.
- **Permission is unchanged.** `buildToolList` gating still decides what may run, and `offeredTools` in `runTurn` is the gated set. So a grouped tool the model calls without loading it still runs, and its group loads for the next step (the same rule as the Custom tier trim). `loadTools` is answered inside `executeAllWithRetry` and names only gated tools; a group whose tools are all switched off comes back `unavailable`.
- Recomputed **every iteration**, so a group loaded mid-turn is usable on the next step. Each load changes the tool list, which costs one prompt-cache miss on Anthropic (tools → system → messages). Stickiness keeps this to a few misses per chat.
- Not used in plan mode (it has its own read-only subset), for Local, or for the Custom Medium / Slim tiers (they have their own lists).
- `tests/unit/toolGroups.test.ts` fails if a tool is in neither core nor exactly one group. A new tool must be placed deliberately.

**Turn-0 budget.** `tests/unit/aiContextBudget.test.ts` caps the system prompt, the first request's tool schemas, the full tool list, and any single tool schema (with an allowlist for today's oversized ones). `npm run ai:budget` prints the report: each piece, each group, the heaviest tools, and the largest `ai.md` sections. Lower a ceiling when a trim lands; don't raise one to fit a feature. The context meter counts the tool schemas actually sent for every provider except Local (`requestToolChars` in `aiPanel.ts`, #1126).

**Stale tool-payload pruning** (`pruneStaleToolPayloads` in `src/ai/historyElision.ts`, gated by `ai.pruneStaleToolPayloads`). This is the text counterpart of render-image elision, inspired by OpenCode's dynamic-context-pruning plugin. Like elision it rewrites only the request copy. It replaces the following with one-line notes:

- code bodies beyond the newest `ai.keepRecentCodeBodies`. A body is the `code` argument of a tool call, or a `getCode` result.
  - Editor writes (`setCode` / `runAndSave` / `forkVersion`) and `getCode` results are counted per object. The count resets at every object switch (`changeObject` / `createObject` …).
  - Side-effect-free runners (`runCode` / `runIsolated` / `runAndAssert` / `runAndExplain`) form a separate list, so a scratch snippet never evicts the real program.
- a `readDoc` result when the same doc is read again later;
- large values in a failed call's input once `ai.failedCallInputTurns` newer assistant turns have passed (the error text stays).

Stubbing a body edits an earlier message, which invalidates the cached prefix from there on (provider prompt caching, llama.cpp KV reuse). So bodies pile up to keep + `ai.codeBodyTrimBatch` and are then cut back in one step. This is the same stateless schedule as the stepped image trim (`imagesToElide`).

Tool-call ids repeat across turns (Gemini numbers calls per response, `gemini_call_0`, and WebLLM does the same). A result is therefore paired with its call by position (the assistant message and the user message right after it), and every key includes the message index. Gemini-signed calls (`thoughtSignature`) are never rewritten.
