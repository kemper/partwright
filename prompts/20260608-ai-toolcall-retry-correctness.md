---
session: "serene-allen"
timestamp: "2026-06-08T00:15:00Z"
sequence: 1
---

## Human

Pre-release cleanup: 12 subagents audited the codebase for bugs. After
leader-verifying the findings, fix them and split into topical draft PRs off the
latest main. This PR collects the AI chat-loop / provider-transport correctness
findings.

## Assistant

## Key decisions

**OpenAI-compatible servers silently dropped tool calls** (`openai.ts`): the
Chat Completions stream keyed tool-call buffers on `tc.index ?? 0`. OpenAI
proper always sends a numeric `index`, but llama.cpp/vLLM/Ollama compat shims
(the Custom provider's whole audience) routinely omit it, so every distinct call
collapsed into bucket 0 — their argument fragments concatenated into one
invalid-JSON blob, `parseToolArgs` returned `{}`, and all calls after the first
vanished. Reworked the buffer to a string-keyed map plus a `toolOrder` array
(mirroring the Responses path): key on `index` when present, else the call `id`,
else treat a bare delta as a continuation of the current call (`lastToolKey`).
This handles indexed streaming, whole-call deltas with distinct ids, and the
id-on-first-then-bare-continuation pattern. Rejected the sibling audit claim that
`Object.values` reorders ≥10 calls — integer-keyed iteration is ascending
numeric, so order was already correct; the real defect was the merge, not order.
Added an e2e regression (`ai-providers.spec.ts`) asserting two index-less calls
survive with parsed args.

**Auto-retry re-ran non-idempotent tools** (`chatLoop.ts` + `tools.ts`): the
`autoRetry` loop re-invoked any tool that returned `isError`, including
`runAndSave`/`saveVersion`/`forkVersion` (duplicate a version), the `paint*`
family (double-paint), `addSessionNote` (append twice), the relief imports
(retry skips the confirm prompt), and the surface modifiers. A tool that
partially succeeds then errors would double-apply. Added a `RETRY_SAFE_TOOLS`
allowlist of pure reads, idempotent renders, and non-committing runs; the loop
now only retries members. Default `autoRetry` is 0, so this only changes
behavior for users who opted into 1/3 retries — toward correctness.

**Aborted Anthropic turns reported zero usage** (`anthropic.ts`): the abort
branch returned `{0,0,0,0}` even though input/cache tokens are billed at request
time and partial output is billed too, so the spend cap and cost meter
under-counted every Stop/stall. Accumulate usage from the streamed
`message_start` (input/cache) and `message_delta` (running output) events into a
`partialUsage`, and return that on abort — matching the OpenAI/Gemini abort paths
that already preserve usage.
