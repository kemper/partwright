---
session: "pdeg45"
timestamp: "2026-06-09T10:18:16Z"
model: claude-opus-4-8
---

## Human

The system prompt that is given to the AI in the AI pane seems quite large.
I think it could be more terse but I'm also unsure if all the information
applies (it mentions not writing to an examples directory but that was a
problem I had with a CLI AI agent once upon a time). Generally it just seems
verbose and I imagine we could save tokens making it smaller. If you do
decide to slim it down explain why and estimate the cost savings.

## Assistant

## Key decisions

**What the in-app AI's system prompt actually is.** For the four cloud
providers (Anthropic, OpenAI, Gemini, Custom) `buildActiveSystemPrompt` returns
`PREAMBLE` (in `src/ai/systemPrompt.ts`) + the full `public/ai.md`, sent as the
cached prefix; the per-turn `toggleSuffix` rides alongside uncached. Local
models use the separate slim/medium prompts, not this. Measured sizes: PREAMBLE
was ~13.4K chars (~3.6K tokens); ai.md is ~21K tokens; total ~22–24K.

**Scope: trim the PREAMBLE, leave ai.md alone.** The PREAMBLE is sent ONLY to
the in-app AI, so trimming it is safe. `public/ai.md` is dual-audience (the
in-app prompt AND the public/console/external-agent reference linked from
`llms.txt` and the help page) and is already a terse API reference backed by
on-demand `readDoc` subdocs — gutting it risks the external/console surface for
little prose savings. So the trim is confined to the PREAMBLE.

**Removed the inapplicable `examples/` line** the user flagged: "do not write
to examples/" was carried over from the CLI-agent context (CLAUDE.md). The
in-app AI has no filesystem and cannot create files at all, so the instruction
was meaningless and slightly confusing.

**Moved paint detail to where it's already pulled on demand.** Lines ~72–244 of
the old PREAMBLE were a long paint tutorial (fan-bleed, coverageMode,
paintExplain histograms, the probePixel/paintConnected vision loop, SCAD label
rules, getFeatureCentroids, topOnly). Every bit of that is already in
`/ai/colors.md`, which the model fetches via `readDoc("colors")` before painting
(and ai.md's color section already directs it there). Forcing all that into the
always-on cached prefix taxed every turn — including the majority that never
paint. I condensed it to a `readDoc("colors")` pointer plus the handful of
non-obvious gotchas worth keeping always-on (labelled construction +
subtraction caveat, paintPreview-first, paint tools are separate calls,
undoLastPaint/removeRegion vs clearColors, forkVersion carries colors).

**Kept the genuinely behavioral, preamble-only guidance** that isn't in ai.md:
concise-chat / act-don't-narrate, never paste share/export links, toggle
awareness ("Capabilities this turn" overrides earlier turns), interrupted-tool
recovery (verify before re-running to avoid duplicate versions), ask-one-
clarifying-question, and the visual-verification reminder.

**Result.** PREAMBLE: 13,372 → 4,202 chars (~3,614 → ~1,135 est. tokens), a
~69% / ~2,480-token cut. Also fixed a stale comment in `chatLoop.ts` that
claimed ai.md was "~12.5K tokens" (it's ~21K).

**Cost impact.** The prefix is prompt-cached, so the steady-state per-turn cost
is a cache *read* — but ~2.5K fewer tokens still lowers (a) the full-price cache
*write* on every cold turn (session start and after each 5-min cache-TTL idle
gap), (b) the 10%-rate cache read on every turn (~250 tok-equiv/turn), and
(c) full per-turn cost on the Custom provider when the self-hosted endpoint
doesn't cache. Order-of-magnitude: a session with a handful of cold starts and
~20 turns saves on the order of low-tens-of-thousands of input-token-equivalents;
the larger, unmeasured win is less always-on noise so the model focuses.

**Verification.** `npm run build` (tsc) clean; `npm run test:unit` 815/815 pass.
A throwaway Playwright spec asserted the assembled prompt no longer contains the
`examples/` line, still contains the kept guidance, and screenshotted the AI
panel rendering correctly. The existing `toggleSuffix` paint-ON/OFF test is
unaffected (suffix untouched).
