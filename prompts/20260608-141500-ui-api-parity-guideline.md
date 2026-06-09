---
session: "qvftq3"
timestamp: "2026-06-08T14:10:00Z"
model: claude-opus-4-8
---

## Human

Can we also add something to CLAUDE.md/AGENTS.md so that future agents are more
likely to keep the JS API in parity with UI capabilities — or would extra agent
instructions or non-AI lint tasks have prevented the issues you found?

## Assistant

## Key decisions

**Assessment of preventability** (which drove what I added):

- **UI→API parity gaps** (the main finding: capabilities reachable only by
  clicking) are *not* reliably catchable by a static lint — there's no typed
  link between a DOM button/command and a `window.partwright` method, so a
  scanner can't know a capability is "missing." The robust structural fix is a
  shared capability registry both layers derive from (a larger refactor, noted
  as aspirational). Pragmatic prevention = a documented **same-PR parity norm** +
  a **review-time check**. So I added both rather than a lint.
- **UI-consistency drift** (hand-rolled modals, ad-hoc button classes) *is*
  catchable — `lint:consistency` (ast-grep) already exists; the guidance now
  points at it and at promoting clean rules to `error`.
- **Doc drift** (the `help()` table covering only ~half the API) *is* catchable
  by a cheap test asserting `help()` keys stay in sync with the live API — I
  recommended it as a follow-up but did not build it here (it needs an
  allow-list seed + lives in the e2e tier; out of scope for a docs change).

**What I changed:**

1. `CLAUDE.md` — new "UI ↔ JS-API parity" development guideline: the product
   goal (anything the UI can do, the API can do), the same-PR 4-step checklist
   (add the `partwrightAPI` method + validation → register in `help()` →
   document in `ai.md`/subdoc → consider an `src/ai/tools.ts` tool), an honest
   note on why a static lint can't enforce it, and the cross-engine bake caveat.
   (`AGENTS.md` is a symlink to `CLAUDE.md`, so one edit covers both.)
2. `.claude/agents/work-reviewer.md` — added a "UI ↔ JS-API parity" hunt item so
   the pre-merge review agent flags a UI affordance that lands with no API
   method / `help()` entry / doc, and any commit path that assumes manifold-js
   without `engineBakeWarning`.

Docs/instruction-only change — no source touched, so no build/test impact.
