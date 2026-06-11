---
session: "13xq3f"
timestamp: "2026-06-09T12:00:00Z"
---

## Human

I tried Gemini recently and got this error: `Gemini 400: … Unknown name
"exclusiveMinimum" at 'tools[0].function_declarations[79].parameters.properties[0].value':
Cannot find field. …`

## Assistant

## Key decisions

**Root cause: Gemini's OpenAPI schema subset rejects `exclusiveMinimum`.** The
`scaleModel` tool's `sx`/`sy`/`sz` params carry `exclusiveMinimum: 0` (a valid
JSON Schema keyword Anthropic/OpenAI accept). `sanitizeSchemaForGemini` in
`src/ai/gemini.ts` already strips `$schema`/`additionalProperties` for exactly
this reason, but didn't strip the exclusive-bound keywords, so the whole tool
list 400'd before any turn could run.

**Fix: drop `exclusiveMinimum`/`exclusiveMaximum` during sanitization.** Added a
skip for both keys alongside the existing `$schema`/`additionalProperties` skip.
Gemini's subset only understands `minimum`/`maximum`; the exclusive bound is a
non-critical guard (a scale factor of exactly 0 is nonsensical but the model
won't send it), so dropping it is safe rather than translating to a non-exclusive
`minimum`. The recursion already walks `properties`/`items`, so nested
occurrences (e.g. array `items`) are covered.

**Regression test.** Added an e2e test in `tests/ai-providers.spec.ts` that
drives `gemini.streamTurn` with a tool carrying `exclusiveMinimum` (top-level)
and `exclusiveMaximum` (in array `items`), captures the outgoing request body,
and asserts neither keyword survives while the surrounding param schema does.

## Human (follow-up)

Can we update our agent instructions to prevent this in the future?

## Assistant

**Documented the constraint at the point of use and in CLAUDE.md.** Added a
comment on the `ToolDefinition` interface in `src/ai/tools.ts` (where schemas
are authored) spelling out the safe cross-provider keyword subset and the rule:
if you reach for a keyword Gemini's OpenAPI subset rejects, add it to
`sanitizeSchemaForGemini`'s strip set in the same change. Mirrored a short
version onto the Gemini provider bullet in `CLAUDE.md` so the canonical agent
instructions carry it too.
