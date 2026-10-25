---
session: "ijeftq"
timestamp: "2026-10-25T23:32:09Z"
---

## Human

Asked to bring an old docs PR (README / help page / SECURITY.md refresh)
up to date with the latest main.

## Assistant

## Key decisions

**Merge, not rebase.** The branch was already pushed and reviewed, so main
was merged in. The one conflict, the help page's Import paragraph, kept
main's new 3MF import text and added this branch's VOX / SVG / image text.

**Refreshed claims that went stale during the two weeks.** SECURITY.md
said model code runs with full access to `window` and browser APIs. Since
then, model code never runs on the main thread, and the engine Worker strips
network and storage globals before it evaluates anything, with an opt-in
cross-origin sandbox on top. The "Code execution model" section now
describes that. The note that the CSP allows `https:` fetches now says this
doesn't reach model code. The README's import list gained 3MF, the
photo-driven flows mention part detection, the privacy line mentions the
locked-down Worker, and the help page gained a Detect parts paragraph
(Tools menu "🧩 Parts", palette "Detect parts…", `/parts`).
