// gates.mjs — the acceptance predicate for "this candidate matches the
// target". Single source of truth consumed by turn.mjs, sweep.mjs, and
// report tooling.
//
// Why not just chamfer: the v1 loop passed "mean chamfer 0.42mm" while the
// user's eye correctly failed the parts. Chamfer averages — a missing
// through-hole, a squared-off dome, or one 3mm-misplaced finger barely
// moves it. These gates target the visual failure modes directly.
//
// MUST gates (all required for "done"), scale-stated for ~10-35mm parts
// printed at 0.2mm layers; thresholds are data, not code:
//   topology     genus + componentCount match
//   hausdorff99  P99 of exact signed |distance|, both directions ≤ 0.4mm
//   hausdorffMax absolute max ≤ 0.8mm (any single missing small feature)
//   volumeIoU    voxel-grid intersection/union ≥ 0.95
//   worstFinding no symmetric-difference blob > 4mm³
//   volumeRatio  candidate/target volume within ±2%
//
// SHOULD gates (advisory — reported, never blocking):
//   chamfer      exact mean ≤ 0.12mm (demoted from primary; it earned it)
//   areaRatio    surface area within ±4% (missing fillets shed area)
//
// Calibration (measured, not guessed): IoU is harsh on thin-walled parts —
// frame_ankle (1.25mm C-clip walls) vs ITSELF translated by an invisible
// 0.05mm scores IoU 0.9555; by 0.1mm, 0.9027. So 0.95 is the boundary
// between "same shape, sub-layer registration noise" and real disagreement;
// the worst-finding gate (0.56mm³ at 0.05mm offset) carries the localized
// discrimination. Re-run this self-offset calibration when changing
// thresholds, and re-run sweep.mjs to confirm the user-eye property: parts
// the eye flagged fail at least one MUST gate, visually-converged ones pass.

export const GATE_THRESHOLDS = {
  hausdorff99_mm: 0.4,
  hausdorffMax_mm: 0.8,
  volumeIoU: 0.95,
  worstFinding_mm3: 4.0,
  volumeRatio_tol: 0.02,
  chamfer_mm: 0.12,
  areaRatio_tol: 0.04,
};

/**
 * Evaluate all gates. Inputs are the artifacts the eval pipeline already
 * produces — this function only judges, it never measures.
 *
 * @param {object} inputs
 * @param {object} inputs.distance   signedMeshDistance() result
 * @param {object} inputs.voxel      voxelDiff() result
 * @param {object} inputs.targetTopology    meshTopology(target) from probe.mjs
 * @param {object} inputs.candidateStats    { componentCount, genus, volume, surfaceArea } from the engine
 * @param {object} inputs.targetStats       { volume_mm3, surfaceArea_mm2 } from probe cmdBbox
 * @param {object} [thresholds]      override GATE_THRESHOLDS
 * @returns {{ pass, must, should, failed, summary }}
 */
export function evaluateGates(inputs, thresholds = GATE_THRESHOLDS) {
  const { distance, voxel, targetTopology, candidateStats, targetStats } = inputs;
  const t = { ...GATE_THRESHOLDS, ...thresholds };
  const must = [];
  const should = [];

  const p99 = Math.max(distance.candToTarget?.p99 ?? Infinity, distance.targetToCand?.p99 ?? Infinity);
  must.push(gate('hausdorff P99', p99, `<= ${t.hausdorff99_mm}mm`, p99 <= t.hausdorff99_mm, 'a small feature is missing or badly misplaced'));

  const hMax = distance.hausdorff ?? Infinity;
  must.push(gate('hausdorff max', hMax, `<= ${t.hausdorffMax_mm}mm`, hMax <= t.hausdorffMax_mm, 'at least one point of one mesh is far from the other'));

  const iou = voxel?.volumeIoU ?? 0;
  must.push(gate('volume IoU', iou, `>= ${t.volumeIoU}`, iou >= t.volumeIoU, 'the solids overlap poorly — mass is in the wrong place'));

  const worst = voxel?.findings?.[0]?.volume_mm3 ?? 0;
  const worstDesc = voxel?.findings?.[0]
    ? ` (${voxel.findings[0].id}: ${voxel.findings[0].sign} ${worst.toFixed(1)}mm³ at rel [${voxel.findings[0].relCentroid.map((x) => x.toFixed(2)).join(', ')}], ${voxel.findings[0].classification})`
    : '';
  must.push(gate('worst finding', worst, `<= ${t.worstFinding_mm3}mm³`, worst <= t.worstFinding_mm3, 'a localized blob of disagreement' + worstDesc));

  if (targetTopology && candidateStats) {
    // Convention bridge: the engine reports genus = 1 − χ_total/2 (treats
    // all shells as one surface), while the target profile reports the
    // per-shell sum, genus = components − χ/2. On a single-shell mesh they
    // agree; on a multi-shell target (internal debris voids are common in
    // real STLs) they diverge and a FAITHFUL reconstruction would fail.
    // Convert the target's per-shell genus to the engine convention before
    // comparing: 1 − χ/2 = 1 − components + genusPerShell.
    const expectedEngineGenus = 1 - targetTopology.components + targetTopology.genus;
    const genusOk = candidateStats.genus === undefined || candidateStats.genus === expectedEngineGenus;
    const compOk = candidateStats.componentCount === undefined || candidateStats.componentCount === targetTopology.components;
    must.push(gate(
      'topology',
      `genus ${candidateStats.genus ?? '?'}/${expectedEngineGenus}, components ${candidateStats.componentCount ?? '?'}/${targetTopology.components}`,
      'equal',
      genusOk && compOk,
      'missing/extra holes or pieces — the loudest visual defect, nearly invisible to chamfer',
    ));
  }

  if (targetStats?.volume_mm3 && candidateStats?.volume) {
    const ratio = candidateStats.volume / targetStats.volume_mm3;
    must.push(gate('volume ratio', ratio, `1 ± ${t.volumeRatio_tol}`, Math.abs(ratio - 1) <= t.volumeRatio_tol, 'net material error (hidden internal geometry, wrong wall thickness)'));
  }

  should.push(gate('chamfer', distance.chamfer ?? Infinity, `<= ${t.chamfer_mm}mm`, (distance.chamfer ?? Infinity) <= t.chamfer_mm, 'overall polish'));
  if (targetStats?.surfaceArea_mm2 && candidateStats?.surfaceArea) {
    const ar = candidateStats.surfaceArea / targetStats.surfaceArea_mm2;
    should.push(gate('area ratio', ar, `1 ± ${t.areaRatio_tol}`, Math.abs(ar - 1) <= t.areaRatio_tol, 'missing fillets/texture shed area with little volume change'));
  }

  const failed = must.filter((g) => !g.pass);
  return {
    pass: failed.length === 0,
    must,
    should,
    failed: failed.map((g) => g.name),
    summary: `${must.length - failed.length}/${must.length} MUST, ${should.filter((g) => g.pass).length}/${should.length} SHOULD`,
  };
}

function gate(name, value, threshold, pass, why) {
  return {
    name,
    value: typeof value === 'number' ? +value.toFixed(4) : value,
    threshold,
    pass,
    why,
  };
}

/** Render a gate result as the markdown table the feedback bundle prints. */
export function gatesToMarkdown(result) {
  const rows = [
    '| gate | value | threshold | status |',
    '|------|-------|-----------|--------|',
  ];
  for (const g of result.must) {
    rows.push(`| ${g.name} (MUST) | ${g.value} | ${g.threshold} | ${g.pass ? 'PASS' : '**FAIL** — ' + g.why} |`);
  }
  for (const g of result.should) {
    rows.push(`| ${g.name} (should) | ${g.value} | ${g.threshold} | ${g.pass ? 'pass' : 'fail'} |`);
  }
  return rows.join('\n');
}

/**
 * Composite score for best-pointer ordering (NOT for acceptance — gates
 * decide that). Lower is better. Blends the gate-relevant quantities so a
 * candidate that trades one gate against another still ranks sensibly.
 */
export function compositeScore(inputs) {
  const { distance, voxel } = inputs;
  const p99 = Math.max(distance.candToTarget?.p99 ?? 10, distance.targetToCand?.p99 ?? 10);
  const iouPenalty = 1 - (voxel?.volumeIoU ?? 0);
  const worst = voxel?.findings?.[0]?.volume_mm3 ?? 0;
  return (distance.chamfer ?? 10) + 0.5 * p99 + 5 * iouPenalty + 0.02 * worst;
}
