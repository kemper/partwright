---
session: "retro-review-2026-w29"
timestamp: "2026-07-17T00:00:00Z"
---

## Human

(Scheduled weekly trigger.) Run the `/retro-review` skill: read `retros/inbox/`,
cluster entries by cross-agent frequency, apply confident CLAUDE.md/docs
diffs, file anything needing new tooling or agent/hook changes as backlog,
write a durable report, archive the processed entries, and open a draft PR.

## Assistant

## Key decisions

**10 inbox entries, all from distinct PRs/sessions spanning 2026-07-03 to
2026-07-07.** Two systemic clusters stood out by cross-agent frequency: the
inverse-CAD orchestration tooling gap (status/driver script never built,
raised independently by 3 of the 5 inverse-CAD sessions) and the lack of a
warm-browser loop for UI iteration (raised by 2 unrelated UI PRs, echoing a
wish from prior retro cycles). Both need new scripts/tooling, so they went to
the backlog rather than a doc edit, per the skill's scope rule.

**Applied four small, high-confidence doc diffs despite single-session
frequency**, because each was a precise, cheap clarification of an existing
rule rather than a new one — in keeping with "treat instructions like code,
edit the stale line rather than append":
- `CLAUDE.md`'s `main.ts` NUL-byte section named `grep -a`/`rg -a` generically,
  but the dedicated `Grep` tool has no `-a` override and silently mis-searches
  the file — reworded to point straight at `Bash grep -an`.
- Same section gained a paragraph on `main.ts`'s module-scope vs.
  setup-function-scope split, since a session had to rewrite a helper after
  discovering its siblings live in the wrong scope.
- `docs/architecture-notes.md` gained a "New Worker clients" section
  documenting the `init`→`ready`→`error` handshake, after a Worker pool hung
  forever (no thrown error) from a client that skipped it.
- `docs/playwright-guide.md` gained a numbered gotcha: rail/list drag e2e
  needs a taller-than-default viewport, or rows silently clip out of the drag
  target.
- Added an explicit `showToast(message, opts)` signature example to the User
  Messaging section after a session guessed the old two-positional-arg form
  and paid a typecheck round-trip.

**Left the tool-history "four separate repair implementations" gap
(already filed as #914 by its originating session) and the provider-diagnostics
tagging wish in the backlog only** — both are single-session, already tracked
via GitHub issue or clearly scoped as new tooling, not something to guess at
via a CLAUDE.md rule.

**No merge — opened as a draft PR per the skill's human-gate requirement.**
