---
date: 2026-06-17
branch: claude/dazzling-franklin-ty7poh
files_changed:
  - src/ai/tools.ts
  - src/main.ts
  - public/ai.md
  - tests/ai-part-target.spec.ts
---

## Human

Saw an AI session working on a part; the user switched the viewed part from the
part menu mid-turn. The AI was doing "select part → get current part" to read a
part's info — fragile, because the human can move the current-part pointer while
the AI works, so the AI ends up operating on the wrong part. Asked: it'd be
better if the AI addressed parts directly by name/index instead of fetching the
current part; keep changePart for when the user should watch the view change.
Also flag any other cases of this class in the AI tool system.

Chosen scope (via AskUserQuestion): the robust fix — give the mutating
read/run/paint tools an explicit part target so addressing is decoupled from the
shared "current part" focus.

## Assistant

Root problem: almost every AI tool acts on an *implicit* current-part pointer
that is shared mutable state between the human and the agent — the same
cross-actor bleed CLAUDE.md flags for tabs, but within one tab. The "changePart
→ getCurrentPart" dance is a verification crutch for that shared pointer.

Fix — separate *addressing* (which part an op targets) from *focus* (which part
the human sees):

- **`PART_TARGETABLE_TOOLS`** set in `tools.ts` lists the part-scoped tools
  (reads, runs, paint, version ops, surface/transform). A post-array loop injects
  a shared optional `part` property into each one's schema, so the description
  lives in one place and can't drift. The prop is typeless on purpose: it accepts
  a name/id string OR a 0-based index number. (Gemini's sanitizer defaults
  typeless props to `string`, so Gemini callers get name/id addressing; the other
  providers accept the full union including index.)
- **Central switch in `executeTool`**: before running a part-scoped tool, if it
  carries a `part` target, `focusTargetPart` resolves it (via the public
  listParts/changePart API) and switches focus *first*, so the op acts on the
  named part — not whatever the user last clicked. The key is stripped before the
  per-tool API sees it (those reject unknown keys). It is a no-op when the target
  is already current, which preserves any in-progress editor draft on that part.
- **`resolvePartTarget` (main.ts)** gains 0-based index support, and a bare string
  now resolves as id-OR-name (ids first). This gives the console/MCP API the same
  flexible addressing: `changePart('Lid')`, `changePart(0)`, plus renamePart/
  deletePart. Signatures + help() + ai.md updated.
- **Reframed descriptions**: `changePart` is now "change what the USER sees" and
  notes you rarely need it just to work on another part; `getCurrentPart` notes
  it's rarely needed (prefer addressing by name/index); `listParts` documents the
  `part` target.

Decision: switch-then-act (focus follows the named part) rather than true
headless operation on a non-focused part. The user explicitly accepted the view
following ("the user can watch the view change"), and headless mutation would
require rewriting the engine/viewport pipeline that paint/run/render depend on —
a much larger, riskier change. Noted as a possible future follow-up.

Other instances of the same class flagged to the user for follow-up (not fixed
here): `runCode`/`runAndSave` defaulting to the live editor buffer (which the
user may be typing into); current-session and current-version pointers; global
toggles. These are tracked in the chat for separate issues.

Tests: `tests/ai-part-target.spec.ts` covers console changePart by name/index,
a part-scoped tool reaching a non-current part by name and index (and a clean
error on a bad target), and runAndSave committing to the targeted part only.
