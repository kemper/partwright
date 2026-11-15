---
session: "b01bd443"
timestamp: "2026-11-15T18:50:00Z"
model: claude-opus-5-5
---

## Human

(Stage B of image tools, #1256.) CodeQL flagged two high-severity alerts in
the new options-literal parser.

## Assistant

## Key decisions

**Replace the trailing-comma lookahead regex with a linear scan.** The regex
skipped whitespace and comments with nested quantifiers, which can backtrack
exponentially on comment-heavy input. A small `nextSignificantIndex` scanner
does the same job in one pass; a unit test covers a comma before comments and
a 5000-comment input.

**Escape every regex metacharacter in the variable name.** JS identifiers
can't contain them, so this wasn't exploitable, but the full escape is the
correct pattern and clears the alert.
