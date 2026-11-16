---
session: "01QnZGNLYzd647pdpggrruwj"
timestamp: "2026-11-03T05:50:00Z"
---

## Human

After closing an unsolicited outside pull request, asked for a contributing
file saying the owner reserves rights to contributions.

## Assistant

## Key decisions

**Why it matters:** the README says commercial rights are reserved by the
copyright holder, but the repo had no contribution terms. Merged outside code
would stay the contributor's copyright, which would block offering that code
commercially or under another license later.

**License grant, not copyright assignment:** contributors grant Partwright
Studio a perpetual, irrevocable, royalty-free license to use and relicense
their work under any terms, including commercial ones, plus a matching patent
grant. That gives the owner the reserved rights without asking contributors to
hand over copyright, which deters fewer good contributors. Assignment is the
stronger option if the owner wants it.

**How agreement is shown:** submitting a contribution is agreement, and a pull
request must also carry one line, "I agree to the contribution terms in
CONTRIBUTING.md", or it won't be merged. That's lighter than a CLA bot and
leaves a visible record on each PR.

**Gate on agreed issues:** pull requests need an issue a maintainer agreed to
first, so drive-by PRs can be closed without review.

**Third-party content:** the terms restate the no-GPL-code, licensed-assets and
no-characters/brands/likeness rules from CLAUDE.md, so outside contributors see
them too.

The README's License section now links to the file.
