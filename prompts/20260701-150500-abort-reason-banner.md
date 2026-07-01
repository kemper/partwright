---
session: "h0lpkr"
timestamp: "2026-07-01T15:05:00Z"
model: claude-opus-4-7
---

## Human

Attached an exported chat markdown that ends multiple times with
"⊘ Stopped by user. Discard partial" even though the user says they
never clicked Stop. Asked me to investigate.

After investigation confirmed the transcript's `0t out · ~39s` pattern
was the stall watchdog aborting but the banner rendering the same
generic "Stopped by user" text a human click would produce, the user
followed up: "Make the changes you think are best and create a PR."

## Assistant

## Key decisions

**Root cause**: `ChatMessage.aborted` is a single boolean set for three
distinct abort sources — a user Stop-button click, a cross-tab
write-ownership handover, and the stall watchdog giving up after N
silent seconds — and the transcript / export / sticky-outcome banners
all render "Stopped by user" regardless. When the watchdog fires the
transient "Model stalled…" status flashes for a couple of seconds and
then clears, leaving only the misleading banner.

**Fix approach**: Persist WHY the abort happened alongside the boolean,
via a new optional `abortReason: 'user' | 'watchdog' | 'tab-handoff'`
on `ChatMessage`. The reason travels on `AbortController.abort(reason)`
so `signal.reason` carries it into `chatLoop`, which stashes it on the
persisted assistant message. All three UI surfaces (transcript banner,
sticky post-turn outcome, exported markdown) now branch on it and
render distinct copy + colour.

**Backwards compatibility**: New field is optional. Legacy records
(`aborted: true` without `abortReason`) fall through to the historical
"Stopped by user" copy, so nothing pre-existing breaks. Old exports
still import cleanly (the schema value in the file is validated by
major-version compat, not per-field).

**Chose signal.reason over a callback param** because the abort
originates in `aiPanel.ts` (three call sites) but the persistence
happens in `chatLoop.ts`. Threading a reason through 4-5 callback
layers would have touched more code than piggybacking on the AbortSignal
the panel already passes in. `AbortController.abort(reason)` has been
supported in every browser we ship to for ~3 years.

**Colour choice**: watchdog is blue instead of amber — it's not a
"stop", it's a self-recovery signal. Amber stays for the user's own
Stop and for the tab-handoff (both are still an interruption of an
intended run, one deliberate, one by another window of theirs).

**Schema bump 1.17 → 1.18** with a changelog entry, and the existing
`chat-export.spec.ts` assertion was fixed to import SCHEMA_VERSION
(per CLAUDE.md guidance — hardcoded strings there had already been
flagged as a footgun) rather than hardcoding the new value.

**Verified visually** with a throwaway spec that seeded all four cases
(user / watchdog / tab-handoff / legacy-no-reason) into IndexedDB and
screenshotted the transcript. All four render distinctly. Spec deleted
before commit.
