// The distilled "mesh import → editable code" workflow, as a single chat
// prompt (the /reconstruct slash command prefills it; the user hits send).
//
// This is the AI-enhanced tier of the mesh→code feature: the deterministic
// convertToCode tool produces the measured baseline in seconds, and the AI's
// job is the part automation can't do — judging the remake visually, tuning
// resolution where it matters, replacing section-stack regions with cleaner
// semantic primitives, and verifying every change against the imported
// original with evalAgainstImport. Tactics live in /ai/reconstruction.md.

export const RECONSTRUCT_PROMPT = [
  'Reverse-engineer the mesh I imported into faithful, EDITABLE code, then improve on the automatic conversion where you can.',
  '',
  'Read /ai/reconstruction.md first — it holds the measured tactics and traps for this workflow. Then:',
  '',
  '1. Baseline: call convertToCode (standard quality). It rebuilds the model as smooth section-interpolated code, saves a version, and returns metrics. Record the baseline chamfer/hausdorff with addSessionNote.',
  '2. Judge: distances below metrics.sampleSpacing are sampling noise — a chamfer near the noise floor with no hausdorff spikes means the remake is already faithful; renderViews and confirm it also LOOKS right (silhouette, holes, proportions).',
  '3. Improve only what the numbers or renders justify: a too-faceted surface wants a finer `edge` (or quality: "fine"); a hausdorff spike means a missed feature — find it by comparing renders, then either re-convert with a smaller `step` or model that feature semantically (primitives/booleans) and union it in.',
  '4. Verify EVERY edit with evalAgainstImport — never claim fidelity from memory. If an edit makes chamfer or hausdorff worse, revert it (loadVersion) rather than stacking guesses.',
  '5. Stop when chamfer is near the noise floor, hausdorff has no unexplained spikes, and the render matches the original at a glance. Log the final numbers with addSessionNote.',
  '',
  'Keep the code self-contained (no api.imports references) so it re-renders without the import. Do not smooth or refine the meshed result — levelSet output degrades under post-hoc smoothing; fix resolution at the source instead.',
].join('\n');
