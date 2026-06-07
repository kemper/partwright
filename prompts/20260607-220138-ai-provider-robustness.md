---
session: "a7f3c2"
timestamp: "2026-06-07T22:01:38Z"
sequence: 4
---

## Human

Pre-production audit follow-up: "fix them and group the prs however you think
is most appropriate." This PR collects the AI provider / chat-loop / panel
findings.

## Assistant

## Key decisions

**Worker config overrides silently ignored** (`appConfig.ts`, `agentWorkerClient.ts`,
`agentWorker.ts`): the hosted-provider chat loop runs inside the agent Worker,
where `getConfig()` returns static defaults (no localStorage). Only
`toolCallTimeoutMs` was threaded through `run_turn`, despite an in-code comment
claiming thinking budgets were too — so user overrides for thinking budgets,
max-output tokens, transient-retry counts/backoff, and auto-resume caps did
nothing on every hosted turn. Fix: pass the whole `ai` config section in the
`run_turn` message and seed the Worker's config cache with it
(`applyWorkerAiConfig`, a no-op outside a Worker) before anything reads
`getConfig()`. One change covers every ai-config field at once.

**readDoc schema-blocked 5 subdocs** (`tools.ts`): the readDoc tool's input-schema
`enum` listed 15 names but the runtime `SUBDOC_NAMES` validator (and ai.md, and
the tool's own description) listed 20 — so the model was schema-blocked from ever
requesting iteration-workflow/gotchas/visual-verification/spending/manifold-api.
Extracted a single `SUBDOC_NAMES_LIST` and derived both the enum and the Set from
it so they can't drift again.

**OpenAI-compatible tool-call drop** (`openai.ts`): the Chat-Completions path only
set `stopReason` from `finish_reason`, never forcing `tool_use` from buffered
calls. A self-hosted server (llama.cpp/vLLM/Ollama) that streams tool deltas
without a clean `finish_reason:'tool_calls'` left stopReason 'unknown', which
chatLoop treats as a non-tool turn and drops the calls. Now forces `tool_use`
when calls were collected, mirroring the Responses and Gemini paths.

**Transient-error misclassification** (`transientError.ts`): the status regex
matched any 3-digit run, so a status inside an error *body* (e.g. a model name)
could flip fatal↔transient. Anchored it to the actual `[Provider ]<status>:`
message shape and added regression tests (custom no-prefix format + an embedded
digit run that must be ignored).

**Voice input lifecycle** (`voiceInput.ts`, `aiPanel.ts`): the mic kept recording
into the hidden textarea when the panel closed or the route left the editor —
now `hideDrawer()` and `setAiPanelRouteActive(false)` stop it. And `onend`
unconditionally restarted while `wantListening`, so a persistent error spun
onerror→onend→start(); added a consecutive-empty-restart cap (reset on a real
result) so the loop can't run away.

**Diagnostics clipboard** (`aiDiagnosticsModal.tsx`): the Copy-JSON
`clipboard.writeText().then()` had no `.catch`, so a blocked/absent clipboard was
an unhandled rejection with no feedback. Added a `.catch` that routes through
`showToast`. Also removed a dangling JSDoc block in `diagnostics.ts` left by a
deleted export.
