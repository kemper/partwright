---
session: "01BsPPSVZ2oFGFXTxRyBtu1M"
timestamp: "2026-10-24T15:50:00Z"
tools: [subagent, git-worktree, playwright]
sequence: 4
---

## Human

I definitely want core operations available to the agents. (Second review
round on PR #1088.)

## Assistant

- A saved key that contains another saved key leaked its tail, because known
  secrets were replaced in insertion order. They now go longest-first.
- A bare long token used as the whole URL userinfo (`https://TOKEN@host`) is
  now redacted too; short `name@host` forms are left alone.
- `simplifyModel` now awaits the baseline colour restore before returning an
  error, so a retry can't race the repaint. The handler's `reset()` returns
  its promise; UI callers are unchanged.
