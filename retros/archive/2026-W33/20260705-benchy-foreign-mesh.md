# 4-Ls — 3DBenchy: first foreign mesh through the inverse-CAD loop

**Liked** — The framework held: a never-seen internet mesh (self-touching,
225k tris, 3× larger than any prior target) converged all-gates-green in 6
attempts with zero part-specific babying. The PLAYBOOK ratchet worked
exactly as designed: the armor-era §5.25 recipe transferred verbatim, and
the two genuinely new tricks (§5.25e/§5.25f) are general SDF improvements,
not boat hacks.

**Lacked** — A topology reference for dirty meshes. The mesh-χ genus was
garbage (−137.5) and the gate would have failed forever; had to build
`voxelGenus.mjs` mid-task. Also: I baked the catalog from the agent's
*interim* best because the user asked while it was still polishing — a
`state.json` "agent still running" marker (or checking for the completion
notification before consuming best/) would have avoided the re-bake.

**Learned** — Mesh-genus and solid-genus are different quantities and
diverge exactly when meshes self-touch (dummy13 open hand: surface 0,
solid 1). Internet CAD authors put ledges at round numbers, which
resonates with round levelSet grid phases — de-phasing must be default
behavior, not a fix. And CC BY-ND targets need a licensing decision
surfaced at bake time, not discovered at release time.

**Longed for** — (1) The genLevelSet banded emitter composing by nesting
depth (#886) so courtyard-topology meshes don't need the SDF-path detour.
(2) A `turn.mjs` flag or convention distinguishing "agent finished" from
"best exists" so orchestrators don't consume a moving best/. (3) The
foreign-mesh corpus (bracket, organic sculpt, low-poly) as a standing
regression suite once 2–3 more classes converge.
