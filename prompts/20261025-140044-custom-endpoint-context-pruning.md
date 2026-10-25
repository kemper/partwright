---
session: "01e1hc9r"
timestamp: "2026-10-25T13:20:00Z"
model: claude-opus-5-5
tools: [webfetch, vite-node, playwright]
---

## Human

My friend recommended that I use https://github.com/Tarquinen/opencode-dynamic-context-pruning#how-it-works or something similar. He is working with a local model running over open ai endpoint on consumer hardware and thinks it would help this app in that use case. Maybe also help with the frontier models? Investigate and recommend

## Assistant

## Key findings

**The plugin's design already exists here.** DCP rewrites only the outgoing copy of history: it dedupes identical tool calls, purges failed-call inputs, and offers a model-invoked compress tool. Partwright's `historyElision.ts` already does the same send-time-only trim for render images, cache-aware, and auto-compaction already plays the compress role with a cheap summarizer.

**The real problem for a local model is fixed overhead, not history.** Measured on main: the Custom provider sends PREAMBLE + all of ai.md (~39k tokens) plus 162 full tool schemas (~60k tokens) on every request. That is ~100k tokens before the user types. The WebLLM Local path, by contrast, gets a ~1.5k-token prompt. `contextLimitFor()` also assumed 200k for any custom model, so the meter and Auto-compact never fired for a 16–32k server. History pruning can't fix an overhead larger than the window.

**Recommendation**: (1) a per-endpoint context profile (detected or typed window + prompt tier); (2) DCP-style pruning adapted to Partwright's tools (superseded code bodies, repeated readDoc, failed-call inputs). The compress tool was skipped: small models judge poorly when to compress, and auto-compaction covers it.

## Human

do both item 1 and 2. create and issue to track

## Assistant

## Key decisions

**Tracking**: kemper/partwright#1120 with both deliverables; one PR covers both.

**Profile lives on the saved endpoint and is mirrored to toggles** as one nested `customContext` object (window, per-model detected windows, tier). One nested field keeps the toggles plumbing to one line per site, and the agent Worker sees it for free. Old IndexedDB rows and backups default via `withEndpointDefaults` / `parseCustomContext`, so no migration is needed.

**Auto stays Full when the window is unknown.** CLIProxyAPI bridges front frontier models, and an unknown window is the common case there; silently shrinking their prompt would be a regression. Bridges also skip detection.

**Detection probes what each server actually runs with.** These are llama.cpp `/props` n_ctx, Ollama `/api/ps`, LM Studio `loaded_context_length`, and vLLM `max_model_len`. It deliberately ignores llama.cpp's `meta.n_ctx_train`, which is the training length and would overstate the window. Everything is best-effort with a timeout; a failed probe just means no value.

**Medium/Slim cut the tool list, not just descriptions.** Measured: compacting descriptions alone only got ~61k → ~20k tokens, because schema structure (buildCharacter's enums etc.) dominates. A curated subset intersected with the gated list brings Medium to ~9k and Slim to ~2.4k, and toggle gating still applies. Both tiers reuse the existing local prompts, which already teach readDoc-on-demand. Thresholds: Slim < 32k, Medium < 160k, configurable in Advanced settings.

**Pruning is cache-aware by construction.** With keepRecentCodeBodies = 1, each new code call stubs the previous one, a step behind the tail, so the cached prefix before it survives. Code bodies are counted per target object, so editing one object never drops another's only copy. Gemini-signed calls (`thoughtSignature`) are never rewritten, since Gemini rejects tampered signed parts. Their results may still be pruned.

**customContext.ts takes a structural tool type** instead of importing tools.ts. A type import created a madge cycle (tools → settings → customContext → tools).
