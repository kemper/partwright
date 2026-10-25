---
session: "01e1hc9r"
timestamp: "2026-10-25T14:25:00Z"
model: claude-opus-5-5
tools: [subagent]
sequence: 2
---

## Human

(No new human prompt; this applies fixes from an independent review subagent of PR #1125.)

## Assistant

## Key decisions

**Pair results with calls by position, not by id.** Gemini numbers calls per response (`gemini_call_0` every turn) and WebLLM does the same, so an id-keyed map cross-matched results across turns. A probe showed old runAndSave results replaced with "doc omitted" notes, and a signed current runAndSave stubbed as a failed call. Pairing now uses the assistant message and the next user message (the adjacency historyRepair enforces), and every key carries the message index. The signature check is repeated at rewrite time.

**Editor writes and scratch runs are separate lineages.** runIsolated / runAndAssert / runAndExplain (and runCode with inline code) never change the editor, so they must not evict the real program. They now only supersede each other.

**Object lineage via an epoch, not an `object` arg the code tools rarely carry.** Each changeObject / createObject starts a new lineage. Switching A→B→A keeps A's earlier copy (conservative) rather than wrongly dropping it.

**Stepped trims.** The reviewer was right that a one-per-step slide re-writes the previous step's cache on every request (Anthropic breakpoints, OpenAI/Gemini prefix cache, llama.cpp KV reuse). Bodies now pile up to keep + `codeBodyTrimBatch` (default 3) and are cut back in one edit, reusing `imagesToElide`'s stateless schedule.

**The context profile belongs to the endpoint, not the session.** Session snapshots no longer restore it; a restored URL looks up its saved endpoint instead. Otherwise an old snapshot would bring back the Full payload after the user set a small window.

**LM Studio `max_context_length` dropped.** It is the model's maximum, not the on-demand load size, and would have picked Medium for a 4k load.
