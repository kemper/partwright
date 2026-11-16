---
session: "ad71db73"
timestamp: "2026-11-02T20:00:00Z"
---

## Human

Find the Wikimedia Commons originals of the eval reference photos and credit
them.

## Assistant

## Key decisions

- **Matched, not guessed.** A subagent searched Commons and compared
  candidates numerically to each committed PNG (grayscale correlation of at
  least 0.998 at 64 px for all seven), and the side-by-side pairs were checked
  by eye. Licenses were re-read from each file's Commons page before crediting.
- **TASL table in `evals/refs/README.md`** (title, author, source, license, and
  what changed), using the exact credit strings Commons asks for where it gives
  one. The two CC BY-SA files are marked as BY-SA themselves, scoped to those
  files only.
- **The README says the sources were traced after the fact**, and the eval
  README now points new reference photos at that table.
