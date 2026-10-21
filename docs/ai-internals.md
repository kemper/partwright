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

## OpenAI routing (Chat Completions vs Responses API)

`streamTurn` routes per model (gated by `isReasoningModel`):

- **Reasoning models** (`gpt-5*`, `o1/o3/o4`) → Responses API (`/v1/responses`). These reject `reasoning_effort` alongside function tools on Chat Completions. History converts to `input` shape: `message`/`function_call`/`function_call_output` items linked by `call_id`.
- **All other models** → Chat Completions (`/v1/chat/completions`). Uses `messages`/`tool_calls`/`tool` shape.

Both share dangling-tool-call repair, image handling, and review serialization. Non-tool helpers (`validateKey`/`listModels`/`summarize`) always use Chat Completions.

### Strict-adjacency backends behind OpenAI-compatible endpoints

An OpenAI or Custom endpoint may be a gateway proxying to Claude (errors then carry `toolu_` ids but still wear the "OpenAI 400" prefix). Such a backend enforces Anthropic's rule: every `tool_use` id needs its `tool_result` *immediately* after. OpenAI's `tool` role can't carry an image, so a `renderView` image rides on a following `user` message and can split a multi-tool run. Every provider builder therefore runs `repairToolHistory` first and must keep tool results contiguous. "Repair history" reporting nothing to fix while a send still 400s means the bug is in the request builder, not the persisted history.
