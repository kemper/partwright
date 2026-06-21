---
date: 2026-06-21
author: claude (opus-4-8)
task: paintImage AI tool + view-based decal placement (PR #816)
---

## Liked
- The user handed me an AI's own post-mortem ("no bridge between raster images and surface paint"). Treating it as a *hypothesis to verify against the code* rather than a spec paid off: two parallel `explore` agents found the projection engine (`stampImageOntoMesh`) and console method (`paintImage`) already existed — the real gap was AI-tool parity, not geometry. Saved building a primitive that was already there.
- `model:preview` wasn't the right tool here (this is paint, not a model), but the spec-driven browser screenshot was: one scratch spec projecting a transparent-bg "LASAGNA"+disc onto a box proved the whole path and produced a before/after the user could see at a glance.
- The repo's own parity doctrine (CLAUDE.md "UI↔JS-API parity") named the exact bug class before I found it — the capability was reachable by clicking but not from chat.

## Lacked
- No typed link between a `window.partwright` method and its AI tool, so "console method exists but isn't an AI tool" is invisible until an agent fails in the field. A lint that flags `partwright.X` methods absent from `ALL_TOOLS` (with an allowlist for deliberate omissions) would have surfaced this gap proactively instead of via a user's bad experience.
- Discovering how a chat-attached image reaches a tool took a few hops (`attachments.ts` → `getImages()` → `getReferenceImages` filtered list). A one-line "how attachments flow to tools" note in `docs/ai-internals.md` would shortcut that.

## Learned
- `getReferenceImages` numbers its list AFTER filtering to usable-`src` entries — so any tool taking a 1-based "image index from getReferenceImages" must filter identically or the index space diverges. The reviewer caught this; worth remembering for the next ref-image-consuming tool.
- The promptlog PreToolUse guard blocks the *entire* bash command (incl. a leading `git add -A`) before it runs, so "`git add -A && git commit`" with an unstaged prompt log fails with nothing staged. Stage the prompt log in a separate call first.
- `main.ts`'s NUL bytes are localized (template-literal cache keys); the `paintImage` block is plain text + em-dashes, so normal `Edit` worked. `cat -v` renders the em-dash's 0x80 byte as `M-^@`, which can be mistaken for a real NUL.

## Longed for
- The "method exists in UI/console but not as an AI tool" lint above is the biggest lever — it converts a whole class of silent parity drift into a CI signal. The capability-registry refactor CLAUDE.md mentions (one source both the command palette and API derive from) would subsume it.
