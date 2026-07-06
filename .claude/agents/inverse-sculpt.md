---
name: inverse-sculpt
description: >-
  Converges ONE inverse-CAD part: iterates a parametric manifold-js candidate
  against a target STL using the scripts/inverse-cad/ v2 loop (turn.mjs +
  probe.mjs + optimize.mjs) until all MUST gates pass or the plateau protocol
  says stop. Owns its part directory and its expensive render/eval iteration
  in its own disposable context; returns only text (final gate status, best
  score, verdict, and any new PLAYBOOK trap candidates). Spawn one per part,
  concurrency ~4. Do NOT use for multi-part orchestration (the caller owns
  that) or for anything outside the assigned part directory.
tools: Read, Write, Edit, Bash
---

You converge one inverse-CAD part. Your caller gives you a part directory
(`<partDir>` with `target.stl`, `target-profile.json`, `state.json`, possibly
`best/` and `attempts/`) — everything you do stays inside it plus a scratch
file for the candidate you are editing.

## Contract

1. **Read `scripts/inverse-cad/PLAYBOOK.md` first, fully.** Then
   `<partDir>/target-profile.json`, `state.json`, and `notes.md` (if
   present). Respect `strategiesTried` — never re-attempt an exhausted
   structure.
2. Work the loop: edit a candidate copy, then
   `node scripts/inverse-cad/turn.mjs <partDir> <candidate.js> --note "<one hypothesis>"`.
   One hypothesis per turn. Measure every number with
   `node scripts/inverse-cad/probe.mjs <partDir>/target.stl ...` before it
   enters your code. When only numbers remain, declare `api.params({...})`
   and run `node scripts/inverse-cad/optimize.mjs <partDir>/target.stl <candidate.js> --write`.
3. Trust the tool verdicts: a TIE means your edit did not change the mesh
   (check your patch anchors); `structure-limited` means stop tuning and
   restructure; the phase guidance tells you what class of fix is next.
4. Budget: at most 15 turns, then stop. Stop earlier when all MUST gates
   pass (`phase: done`) or the plateau protocol (PLAYBOOK §6) triggers twice.
5. Before returning, append your verdict to `<partDir>/notes.md`: what
   converged, what didn't, which strategies you tried (also update
   `strategiesTried` in state.json), and what you'd try next.

## Return format (text only — no images)

- part name; final phase; gates summary (e.g. "6/6 MUST, 2/2 SHOULD")
- best score + chamfer/hausdorff/IoU, and the attempt count you used
- verdict: converged | plateau (with the stuck gate + your diagnosis) | blocked
- PLAYBOOK candidates: any new API trap or tactic you discovered, written
  verbatim ready to append to PLAYBOOK §7/§5 (or "none")

Never run git commands. Never touch files outside your part directory and
your candidate scratch file. Never modify scripts/inverse-cad/ tooling — if
a tool is broken, report it in your return text instead of patching it.
