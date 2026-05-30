# AI Provider Internals

Reference for per-provider implementation details. Consult when modifying `chatLoop.ts`, `gemini.ts`, `anthropic.ts`, or `openai.ts`.

## Thinking box (reasoning models)

Gemini 3 thinking models emit reasoning as `thought:true` text parts (opt-in via `generationConfig.thinkingConfig.includeThoughts`). `gemini.ts` routes them to a separate channel (`StreamResult.thinking` + `onThinking` callback) so they never bleed into the answer bubble. `chatLoop` persists them as `'thinking'` `ChatBlock`s; the panel shows a live indigo box while streaming (`renderLiveThinkingBox`), then collapses it once the next step begins. `onThinking` beats the stall watchdog so a long think doesn't trip a spurious abort. `'thinking'` blocks are display-only — no provider replays them as model text.

## Gemini thought signatures

Gemini 3+ attaches an opaque `thoughtSignature` that must be echoed back on the exact part it was received on. A missing signature on a `functionCall` part is a hard 400; a missing one on a text part silently degrades reasoning (the "Gemini stalls after thinking" symptom — model bails with a tiny `end_turn`).

In streaming, the signature can ride the `functionCall` part, the answer text part, **or a trailing part whose text is empty**. `consumeGeminiStream` captures it off any part (`pendingSignature`) and binds it to the first tool call (mandatory) or the answer text block (`textThoughtSignature` → persisted on the `ChatBlock`, replayed by `buildGeminiContents`). **Skipping empty-text parts is the classic bug here.**

## Thinking level (the 🧠 pill)

`ChatToggles.thinking` (`off` | `low` | `medium` | `high`, default **off**) maps per-provider at request build time:

- **Anthropic** — `low/medium/high` enable extended thinking with `budget_tokens` 2048/8192/16384 (`THINKING_BUDGET` in `anthropic.ts`). `max_tokens` floats above the budget (API requires `>`). The signed `thinking` block must precede each `tool_use` on replay: `collectResult` captures blocks (with `signature` + any `redacted_thinking`) into `ChatMessage.thinkingBlocks`; `assistantBlocksToApi` re-emits them first — only when thinking is on for the current request (`buildApiMessages(history, { replayThinking })`). Never send them with thinking off; never replay display prose.
- **Gemini** — `off` flips `includeThoughts:false` (deliberately NOT `thinkingBudget:0`, which some Pro models reject); `low/medium/high` set `includeThoughts:true` + growing `thinkingBudget`.
- **OpenAI** — maps to `reasoning.effort` (`low/medium/high`) on the Responses API, sent only for reasoning models (`isReasoningModel`). `off` omits the field. Non-reasoning models go via Chat Completions and never see a reasoning request.
- **Local** — no effect (`<think>` is stripped).

## Auto-continue (the ♾ pill)

`ChatToggles.autoResume` (boolean, **on by default** in standard/full presets) keeps the agent working until the model calls the **`finish`** sentinel tool instead of stopping at every `end_turn`. The default lives in `DEFAULT_TOGGLES_BY_PRESET`; turning it off writes a `custom` preset that `mergeWithDefaults` preserves (explicit `false` is never overwritten).

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
