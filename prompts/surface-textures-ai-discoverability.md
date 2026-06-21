---
date: 2026-06-13
branch: claude/youthful-sagan-gh6b1i
files_changed:
  - public/ai.md
  - src/ai/systemPrompt.ts
---

## Human

I added surface capabilities (e.g. add fuzzy skin to a whole model or just a
region) and thought they were part of the API with enough information that AI
agents running inside the app would know they could use them. I think they're
not implemented as tools but are possible to perform as part of the code itself
(manifold-js in particular). But I'm working with an AI session now that seems
fairly convinced fuzzy skin is not a capability it knows about or can do — which
is discordant with what I remember implementing before the last production
release. Investigate and report back; if confident a change is needed, make it
and open a PR.

## Assistant

Investigated how surface textures reach the in-app AI. The capability is real and
exists three ways: `api.surface.fuzzy({…})` (and `.knit/.cable/.waffle/.fur/
.woven/.knurl/.voronoi/.smooth`) recorded in manifold-js code
(`engines/manifoldJs.ts`), the `applySurfaceTexture(id, opts?, mode?)` AI tool
(`ai/tools.ts`, in `SAVE_GATED` so it's available to every provider whenever Save
Versions is on), and the `applyFuzzySkin()`-family console methods. For cloud
providers the full `public/ai.md` is the system prompt, including the
`api.surface.*` section — so a cloud session is genuinely equipped, and an AI
claiming otherwise is mostly model fallibility.

But two genuine discoverability gaps made it easy for an agent to miss:

1. **Local (WebGPU) models couldn't discover it at all.** The slim and medium
   local system prompts (`systemPrompt.ts`) list the `readDoc` subdoc names
   inline, and `textures` was absent from both — even though the `textures`
   subdoc and the `applySurfaceTexture` tool work for local sessions. A local
   model had no path to learn surface textures exist. Added `textures` to both
   lists with a one-line descriptor naming `applySurfaceTexture` and
   `api.surface.<id>`.

2. **The cloud `ai.md` topic-index entry pointed only at console-method names.**
   The `textures` index row led with `applyFuzzySkin` / `applyKnitTexture` / …
   (the `window.partwright` console methods), none of which are the in-app AI's
   actual tool. An agent scanning the index for "fuzzy" never saw
   `applySurfaceTexture` (the real tool) or `api.surface.<id>` (the real code
   path). Rewrote the row's lead-in to name both, plus the full id list.

Both are doc/prompt-string edits — no logic change. Typecheck passes.
