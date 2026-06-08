---
date: "2026-06-07T16:00:00Z"
task: "feat: voxel-sculpt subagent — move image-heavy iteration off the main thread"
areas: [agents, tooling, context/onboarding]
cost: medium
---

## Liked / Worked
- The `model:preview --lang voxel` headless loop (~2–3 s, PNG + JSON stats) is a
  great fit for a subagent: objective gates come from the cheap JSON
  (`componentCount`, `bbox`, `tris`), only the subjective "does it look like the
  cat" check needs the PNG. That split is exactly what makes delegation pay off.

## Lacked
- During a photo→figurine session the main agent Read ~10 preview PNGs to judge
  iterations. Every one stayed in context and got re-submitted each turn — image
  tokens are the dominant, compounding cost of an interactive sculpting session,
  and nothing in CLAUDE.md flagged it or pointed to a cheaper pattern. (cost: the
  whole session carried a growing image payload.)

## Learned
- **Newly-added `.claude/agents/*.md` are NOT selectable in the session that
  created them** — the agent registry is loaded at session start. The Agent tool
  errors with "agent type not found" until the next session. To test a fresh
  agent definition in-session, run its instructions through `general-purpose`
  (point it at the agent file and tell it to follow it exactly). Worth a line in
  `docs/agent-tooling.md`.
- `SendUserFile` ships a PNG to the user **without** the main agent having to
  `Read` it — so the final, user-judged deliverable can cost zero image tokens
  on the main thread. The only images the main agent must Read are ones *it*
  needs an opinion on, and even those can be delegated.

## Longed for
- The `voxel-sculpt` agent added here is the structural fix: it owns the
  render→look→adjust loop in its own disposable context and returns text only
  (final path + verdict). Pattern generalizes — any "iterate until the render
  looks right" loop (catalog toys, mechanism fit checks) should live in a
  subagent, not the main thread.
- A standing note in CLAUDE.md's verification section: "delegate image-heavy
  iteration to a subagent; `SendUserFile` doesn't require Reading the PNG." Would
  have saved the rediscovery.
- The `--compare a.js b.js …` contact-sheet idea from the prior retro would let
  the subagent judge several variants from one PNG Read instead of N.
