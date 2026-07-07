// The distilled "mesh import → editable code" workflow, as a single chat
// prompt (the /reconstruct slash command prefills it; the user hits send).
//
// This is the AI-enhanced tier of the mesh→code feature. The deterministic
// convertToCode baseline is already near the fidelity metric's ceiling on
// most meshes, so the AI's job is what the baseline can't do: SEMANTIC
// structure. The measurement tools (profileModel / fitInscribed /
// compareToImport) exist so features are found and dimensioned by geometry
// queries — never guessed from renders. Tactics live in /ai/reconstruction.md.

export const RECONSTRUCT_PROMPT = [
  'Reverse-engineer the mesh I imported into faithful, EDITABLE code — and make the code MEANINGFUL, not just accurate. The success bar is semantic structure: recognizable features modeled as measured primitives with named dimensions, section-interpolation kept only where the shape is genuinely organic.',
  '',
  'Read /ai/reconstruction.md first — it holds the measured tactics and traps. Then:',
  '',
  '1. MEASURE before modeling: call profileModel on the import. It fits primitives to cross-sections along every axis and returns runs — "circle r≈2.3 from z=8..14" IS a measured cylinder, "rect 12×8 from z=0..6" IS a measured box. Also try fitInscribed to see if one clean primitive fills most of the volume. Record the discovered skeleton with addSessionNote.',
  '2. Baseline: call convertToCode (standard). Note its metrics — this is the fidelity bar your semantic version must match, and its code is your fallback for the organic regions.',
  '3. Rebuild semantically where the measurements justify it: model every profiled primitive run with real primitives at the MEASURED dimensions (cylinders, boxes, holes from the profile\'s hole fits), and keep/reuse the generated levelSet sections only for runs the profile calls organic. Name key dimensions as constants (or api.params) so the code is truly editable.',
  '4. Verify EVERY change: evalAgainstImport for the scalar check; when a number regresses or looks off, compareToImport to see WHAT and WHERE (signed, located findings — a compact "missing" blob is a feature you dropped). Never claim fidelity from memory; revert regressions with loadVersion.',
  '5. Stop when fidelity matches the baseline (chamfer near its noise floor, no unexplained findings) AND the code reads like something a person would write: named dimensions, primitives for the features, sections only for the organic remainder. Log final metrics + the semantic structure with addSessionNote.',
  '',
  'Keep the code self-contained (no api.imports references). Do not smooth or refine meshed levelSet output — fix resolution at the source. If the whole model profiles as organic (a sculpt, a figurine), say so: the baseline already IS the right answer, and forcing primitives onto it makes the code worse.',
].join('\n');
