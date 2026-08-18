---
date: 2026-07-19
author: claude (opus-4-8)
task: Fix OpenAI 400 "tool_use without tool_result immediately after" + non-working Repair button (PR #927, addresses #914)
---

## Liked
- Searching issues *before* diving into a fix paid off immediately: #914 already diagnosed the exact class of bug (four divergent tool-history sanitizers; OpenAI's position-agnostic global-set matcher can emit an ordering a strict-Anthropic proxy rejects). It turned "why doesn't the button work?" from a theory into a confirmed root cause and handed me the sanctioned fix shape.
- A throwaway in-browser probe (`page.evaluate` driving the real `openai.streamTurn` with a fetch stub, printing the built role order) was the single highest-value step — it *proved* both halves at once: the built order interleaved the image between tool results (`tool → user[img] → tool`), and `repairToolHistory(history).changed === false` (the persisted history was clean, which is exactly why the button looked broken). Turned a plausible story into evidence.
- The existing per-provider request-builder tests (capture the sent body via a fetch stub) were a ready-made pattern to extend — adding the two contiguity regression tests was a copy-and-adjust, not a new harness.

## Lacked
- Any single place that says "here is the canonical valid tool_use/tool_result shape and every provider must produce it." I had to read all four builders (anthropic/openai/gemini/local) + the shared `repairToolHistory` to convince myself which enforced adjacency vs a global set. #914 is literally the issue asking for this unification; the code cost of *not* having it was ~20 min of cross-file tracing.
- A fast way to reason about the proxy's behavior. The error was Anthropic-shaped but wrapped as "OpenAI 400" (openai.ts's error prefix), and the `toolu_` ids meant an OpenAI-compat gateway proxying to Claude. Nothing in the code documents that this cross-provider-proxy topology is a supported/observed setup, so I had to infer it from the id prefix + error wording.

## Learned
- The image-carrying tool result is the concrete trigger: OpenAI's `tool` role can't hold an image, so the image rides on a *following* `user` message. In a multi-tool turn that message splits the `tool` block, and a strict backend then reports EVERY later tool_use id as lacking a result "immediately after" — which is why the reported error named two ids, not one. The native Anthropic builder never hit this because it embeds the image *inside* the tool_result block.
- The Repair button / pre-send auto-repair and the send-path builder were *different* implementations of the same invariant, so "clean per the button" and "valid per the send" could disagree. Routing the builders through the shared `repairToolHistory` (as gemini/local already did) is what makes the button's verdict trustworthy.

## Longed for
- A single `canonicalizeToolHistory()` the UI detector AND all provider builders share, with the per-provider code reduced to pure shape-translation (no invariant logic). This PR moves toward it (all builders now call `repairToolHistory` first; sanitizers demoted to backstops) but stops short of deleting the block-level sanitizers — a good follow-up for #914's final AC.
- A note in `docs/ai-internals.md` that an OpenAI-compatible endpoint may be a strict-adjacency backend (Claude via a gateway), so the OpenAI builders must satisfy Anthropic's adjacency rule, not just OpenAI's laxer one. That single sentence would have shortcut the whole "why is an OpenAI path getting an Anthropic error?" investigation.
