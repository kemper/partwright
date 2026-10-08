---
session: "inverse-cad"
timestamp: "2026-07-04T10:00:00Z"
model: claude-fable-5
sequence: 50
---

## Human

Asked whether the 37 notes.md files' Dummy 13 spec knowledge should be
captured somewhere durable (a docs directory) for future reuse.

## Assistant

## Key decisions

**Wrote `docs/dummy13-design-spec.md`** (478 lines, synthesized by a
subagent from all notes.md + PLAYBOOK kit entries + metrics): the joint
system with every measured number cited to its measuring part, per-part
architecture catalogs (21 frame + 16 armor), shared archetypes, and a
reuse guide for designing new mating parts. `docs/` per repo convention
(stable AI/developer reference that ships with the project); CC-BY-4.0
attribution included since the repo is public.

**Two stale gap-notes the agent flagged were verified and corrected**:
(1) hand_grip_left's checked-in candidate is the corrected levelSet
version, not the torus-void one (that was fixed two sessions of work
ago); (2) the frame target STLs were NOT actually tracked — the summary
claimed they were, git said 0 files. Force-added all 21 (15MB, CC-BY-4.0)
so re-verification works from a fresh clone, matching the armor set.

The doc's honest remaining gaps: armor_crotch has no structure map
(bootstrap-converged, never agent-decoded), ankle socket radius
2.9046-vs-2.9075 fit variance, corner-line constants vary in the 3rd
decimal across parts.
