---
date: 2026-07-19
author: claude (opus-4-8)
task: Fix OpenAI 400 "tool_use ids without tool_result immediately after" + non-working Repair button (PR #927)
---

## Liked
- Searching the issue tracker before writing code. `search_issues` surfaced #914, which had already diagnosed the exact class of bug (four divergent tool-history sanitizers; the OpenAI global-set matcher being position-agnostic vs a strict-Anthropic proxy). That turned a from-scratch investigation into "confirm the predicted failure mode and implement the proposed fix."
- Reproducing the ordering in a real browser via `page.evaluate` on the builder + the actual reported `toolu_` ids, and printing the built role order. `["assistant","tool(018J)","tool(01LF)","user[img]"]` plus `repairToolHistory().changed === false` was the whole proof in one run — both *what* broke and *why the button looked dead*.
- The error message itself was the strongest clue: two ids + "immediately after" + `toolu_` prefix + "OpenAI 400" wrapper narrowed it to "OpenAI transport, strict-Anthropic backend, multi-tool turn" before reading much code.

## Lacked
- A cheap way to know the persisted history was clean without hand-tracing `repairToolHistory`. I spent several turns theorizing about which history shape could be orphaned before realizing the persisted history was *fine* and the request *builder* was the sole bug. A one-liner "dump the built provider payload for the current chat" dev affordance would have collapsed that.
- Clarity on which provider was actually in use. "OpenAI 400" is a wrapper string that also covers the Custom provider proxying to Anthropic — the report reads like an OpenAI-proper bug but wasn't. The wrapper hides the real transport target.

## Learned
- `PersistedToolResult.image` (renderView snapshots) is the hidden variable in tool-history bugs here: OpenAI's `tool` role can't carry an image, so images ride on a *following* user message and can split an otherwise-valid tool-result run. The native Anthropic builder embeds the image *inside* the `tool_result` block, so it never hits this — the split is OpenAI-transport-specific.
- The "Repair history" button and the pre-send auto-repair both call the same `repairToolHistory` on the *persisted ChatMessage history*. If the corruption is manufactured only in the per-provider request transform, the button honestly reports "nothing to repair" while the send still 400s — the button isn't broken, the builder is. `isToolHistoryMismatchError` surfacing the button on a clean history is what makes it *look* broken.
- Gemini and Local already routed through `repairToolHistory`; OpenAI and Anthropic didn't. Unifying them is a pure win — the block-level sanitizers become no-ops on repaired history, so they stay as free backstops.

## Longed for
- A single shared "build provider payload from ChatMessage[]" seam that every provider funnels through, with the tool-history invariant enforced once at that seam. #914 is the structural version of this; today each provider re-expands the history independently, which is exactly how the image-split slipped past three of four builders.
- A dev-panel button to copy the exact outgoing request body for the current chat. Every tool-history 400 investigation reduces to "what did we actually send," and there's no fast path to that today short of stubbing `window.fetch` in a spec.
