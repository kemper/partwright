#!/usr/bin/env node
// turn.mjs — one turn of the inverse-CAD loop, as one command.
//
//   node scripts/inverse-cad/turn.mjs init <partDir> <target.stl>
//   node scripts/inverse-cad/turn.mjs <partDir> <candidate.js> --note "what changed and why"
//
// A turn: run the candidate through the real engine → exact signed distance
// + voxel-diff findings + acceptance gates → write attempts/NNN/ artifacts →
// update state.json (best/ pointer advances ONLY on improvement — the
// non-regression rule is enforced here, not by agent discipline) → print
// feedback.md to stdout. The agent's loop is: edit code, run this, read the
// text; images are for when text is ambiguous.
//
// Part dir layout:
//   <partDir>/target.stl            (created by init, copied from source)
//   <partDir>/target-profile.json   (cached probe bbox/topology of target)
//   <partDir>/state.json            (resume file: attempts, best, phase)
//   <partDir>/best/                 (champion candidate.js + metrics.json)
//   <partDir>/attempts/NNN/         (candidate.js, metrics.json, feedback.md, compare.png)

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { parseStl } from './stl.mjs';
import { signedMeshDistance } from './surfaceDistance.mjs';
import { voxelDiff } from './voxelDiff.mjs';
import { evaluateGates, gatesToMarkdown, compositeScore, GATE_THRESHOLDS } from './gates.mjs';
import { cmdBbox } from './probe.mjs';
import { voxelGenus } from './voxelGenus.mjs';
import { meshToRenderInputs, composeComparison } from './render.mjs';
import { runPreview } from '../cli/preview.mjs';

function loadMesh(path) {
  const buf = readFileSync(path);
  return parseStl(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
}

function deindexPreview(render) {
  const { positions, triVerts } = render;
  const n = triVerts.length;
  const soup = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = triVerts[i];
    soup[i * 3] = positions[v * 3];
    soup[i * 3 + 1] = positions[v * 3 + 1];
    soup[i * 3 + 2] = positions[v * 3 + 2];
  }
  return { triangles: soup };
}

function readState(partDir) {
  const p = join(partDir, 'state.json');
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
}

function writeState(partDir, state) {
  writeFileSync(join(partDir, 'state.json'), JSON.stringify(state, null, 2));
}

// ---------- init ----------

function init(partDir, targetPath) {
  mkdirSync(partDir, { recursive: true });
  mkdirSync(join(partDir, 'attempts'), { recursive: true });
  mkdirSync(join(partDir, 'best'), { recursive: true });
  const targetDest = join(partDir, 'target.stl');
  if (resolve(targetPath) !== resolve(targetDest)) copyFileSync(targetPath, targetDest);
  const mesh = loadMesh(targetDest);
  const profile = cmdBbox(mesh, targetDest);
  // Foreign meshes are often watertight-but-self-touching (non-manifold
  // edges), which makes the mesh Euler-characteristic genus fractional or
  // wrong. Fall back to the voxel-solid topology, which is what the printed
  // part — and an engine-built candidate — actually has.
  if (!Number.isInteger(profile.topology.genus) || profile.topology.genus < 0) {
    const coarse = voxelGenus(mesh, { res: 0.25 });
    const fine = voxelGenus(mesh, { res: 0.15 });
    const agreed = coarse.genus === fine.genus && coarse.cavities === fine.cavities;
    profile.topology.meshGenus = profile.topology.genus;
    profile.topology.genus = fine.genus;
    profile.topology.components = fine.solidComponents;
    profile.topology.cavities = fine.cavities;
    profile.topology.genusSource = agreed
      ? 'voxel (res 0.25 & 0.15 agree; mesh chi unreliable)'
      : `voxel res 0.15 (UNSTABLE: res 0.25 said genus ${coarse.genus}/cav ${coarse.cavities} — verify by hand)`;
    console.log(`topology: mesh chi unreliable (raw genus ${profile.topology.meshGenus}) — voxel-solid genus ${profile.topology.genus}, cavities ${fine.cavities}${agreed ? '' : ' [UNSTABLE ACROSS RES — VERIFY]'}`);
  }
  writeFileSync(join(partDir, 'target-profile.json'), JSON.stringify(profile, jsonRound, 2));
  if (!readState(partDir)) {
    writeState(partDir, {
      part: basename(partDir),
      target: 'target.stl',
      phase: 'place',
      best: null,
      strategiesTried: [],
      attempts: [],
    });
  }
  console.log(`initialized ${partDir}`);
  console.log(`target: ${profile.triangles} tris, bbox ${profile.bbox.size.map((v) => v.toFixed(2)).join(' × ')}, center [${profile.bbox.center.map((v) => v.toFixed(2)).join(', ')}], genus ${profile.topology.genus}, components ${profile.topology.components}`);
  console.log('next: write a candidate .js and run  node scripts/inverse-cad/turn.mjs ' + partDir + ' <candidate.js> --note "..."');
}

function jsonRound(_k, v) {
  return typeof v === 'number' && Number.isFinite(v) ? +v.toFixed(5) : v;
}

// ---------- phase ladder ----------

function computePhase(gates, distance, voxel, profile, candStats) {
  // PLACE: is the mass in the right place?
  if (candStats?.bbox && profile?.bbox) {
    const cb = candStats.bbox;
    const tb = profile.bbox;
    const candSize = [cb.max[0] - cb.min[0], cb.max[1] - cb.min[1], cb.max[2] - cb.min[2]];
    const candCenter = [(cb.max[0] + cb.min[0]) / 2, (cb.max[1] + cb.min[1]) / 2, (cb.max[2] + cb.min[2]) / 2];
    for (let a = 0; a < 3; a++) {
      const ref = Math.max(tb.size[a], 1e-9);
      if (Math.abs(candSize[a] - tb.size[a]) / ref > 0.05) return 'place';
      if (Math.abs(candCenter[a] - tb.center[a]) > Math.max(0.5, 0.05 * ref)) return 'place';
    }
  }
  const topo = gates.must.find((g) => g.name === 'topology');
  if (topo && !topo.pass) return 'topology';
  if ((voxel?.volumeIoU ?? 0) < 0.9) return 'silhouette';
  const worst = gates.must.find((g) => g.name === 'worst finding');
  if (worst && !worst.pass) return 'features';
  return gates.pass ? 'done' : 'tune';
}

// ---------- the turn ----------

async function turn(partDir, candidatePath, note) {
  if (!note) {
    console.error('turn: --note "what changed and why" is mandatory — the attempt history is the loop\'s memory.');
    process.exit(2);
  }
  const state = readState(partDir);
  if (!state) {
    console.error(`turn: ${partDir}/state.json missing — run  turn.mjs init ${partDir} <target.stl>  first`);
    process.exit(2);
  }
  const target = loadMesh(join(partDir, 'target.stl'));
  const profile = JSON.parse(readFileSync(join(partDir, 'target-profile.json'), 'utf8'));

  const nextId = state.attempts.length ? Math.max(...state.attempts.map((a) => a.id)) + 1 : 0;
  const dir = join(partDir, 'attempts', String(nextId).padStart(3, '0'));
  mkdirSync(dir, { recursive: true });
  copyFileSync(candidatePath, join(dir, 'candidate.js'));

  // 1) Engine run
  const preview = await runPreview(candidatePath, { lang: 'manifold-js' });
  if (!preview.ok) {
    const feedback = `## Attempt ${nextId}: RENDER ERROR\n\n\`\`\`\n${preview.error}\n\`\`\`\n\nThe candidate must return a valid Manifold. Fix and re-run.`;
    writeFileSync(join(dir, 'feedback.md'), feedback);
    state.attempts.push({ id: nextId, note, verdict: 'render-error', error: String(preview.error).slice(0, 500) });
    writeState(partDir, state);
    console.log(feedback);
    process.exit(1);
  }
  const candidate = deindexPreview(preview.render);
  const stats = preview.stats ?? {};

  // 2) Metrics
  const distance = signedMeshDistance(target, candidate, { samples: 20000 });
  const voxel = voxelDiff(target, candidate, {});
  const candStats = {
    componentCount: stats.componentCount,
    genus: stats.genus,
    volume: stats.volume,
    surfaceArea: stats.surfaceArea,
    bbox: stats.bbox,
  };
  const gates = evaluateGates({
    distance,
    voxel,
    targetTopology: profile.topology,
    candidateStats: candStats,
    targetStats: { volume_mm3: profile.volume_mm3, surfaceArea_mm2: profile.surfaceArea_mm2 },
  });
  const score = compositeScore({ distance, voxel });
  const phase = computePhase(gates, distance, voxel, profile, candStats);

  // 3) Artifacts
  const metrics = { ok: true, attempt: nextId, note, score, phase, distance, voxel: { ...voxel, findings: voxel.findings }, gates, candidate: candStats };
  writeFileSync(join(dir, 'metrics.json'), JSON.stringify(metrics, jsonRound, 2));
  try {
    const cmp = await composeComparison({
      target: meshToRenderInputs(target, [190, 200, 215]),
      candidate: {
        positions: preview.render.positions,
        triVerts: preview.render.triVerts,
        triColors: preview.render.triColors,
        bbox: preview.render.bbox,
      },
      size: 384,
      label: { top: 'target', bottom: `attempt ${nextId}` },
    });
    await cmp.toFile(join(dir, 'compare.png'));
  } catch (e) {
    console.error('compare.png failed (non-fatal):', e?.message);
  }

  // 4) Best-pointer with enforced non-regression
  const prevBest = state.best;
  let verdict = 'improved';
  if (prevBest) {
    const failedNow = gates.failed.length;
    if (score >= prevBest.score && failedNow >= prevBest.failedMust) verdict = score === prevBest.score ? 'tie' : 'regressed';
    else if (score < prevBest.score && failedNow > prevBest.failedMust) verdict = 'mixed'; // score better but a MUST gate regressed — best does NOT advance
  }
  const advance = !prevBest || (verdict === 'improved');
  if (advance) {
    state.best = { attempt: nextId, score, failedMust: gates.failed.length, gates: gates.summary };
    copyFileSync(candidatePath, join(partDir, 'best', 'candidate.js'));
    writeFileSync(join(partDir, 'best', 'metrics.json'), JSON.stringify(metrics, jsonRound, 2));
  }

  // 5) Feedback bundle
  const fb = [];
  fb.push(`## Attempt ${nextId} vs best (${prevBest ? prevBest.attempt : '—'}): ${verdict.toUpperCase()}${advance ? ' — best advanced' : ' — best unchanged'}`);
  fb.push('');
  fb.push(`score ${score.toFixed(4)}${prevBest ? ` (best was ${prevBest.score.toFixed(4)})` : ''} | phase: **${phase}** | gates: ${gates.summary}`);
  fb.push('');
  fb.push(gatesToMarkdown(gates));
  fb.push('');
  if (voxel.findings.length) {
    fb.push(`## Findings (largest symmetric-difference blobs, ${voxel.findings.length}/${voxel.totalFindings})`);
    for (const f of voxel.findings.slice(0, 6)) {
      const c = f.centroid.map((v) => +v.toFixed(2));
      fb.push(`- **${f.id}** ${f.sign} ${f.volume_mm3.toFixed(1)}mm³ ${f.classification} at [${c.join(', ')}] (rel [${f.relCentroid.map((v) => v.toFixed(2)).join(', ')}]), extent [${f.extent_mm.map((v) => v.toFixed(1)).join(' × ')}] — ${f.hint}`);
      fb.push(`  probe:  node scripts/inverse-cad/probe.mjs ${join(partDir, 'target.stl')} section --axis z --at ${c[2]} --fit`);
      fb.push(`  probe:  node scripts/inverse-cad/probe.mjs ${join(partDir, 'target.stl')} fit --near ${c.join(',')} --r ${Math.max(2, Math.max(...f.extent_mm) / 2).toFixed(1)}`);
    }
    fb.push('');
  }
  fb.push(`signed skin: candidate excess ${distance.candToTarget.excessArea_mm2?.toFixed(1)}mm² / sunk ${distance.candToTarget.missingArea_mm2?.toFixed(1)}mm²; target uncovered ${distance.targetToCand.excessArea_mm2?.toFixed(1)}mm²`);
  fb.push(`volume: cand ${candStats.volume?.toFixed(1)} vs target ${profile.volume_mm3?.toFixed(1)}mm³ | IoU ${voxel.volumeIoU.toFixed(4)} | excess ${voxel.excess_mm3.toFixed(1)} missing ${voxel.missing_mm3.toFixed(1)}mm³`);
  fb.push('');
  fb.push(`images: ${join(dir, 'compare.png')}`);
  fb.push(`phase guidance: ${phaseGuidance(phase)}`);
  const feedback = fb.join('\n');
  writeFileSync(join(dir, 'feedback.md'), feedback);

  // 6) State update
  state.attempts.push({
    id: nextId,
    note,
    verdict,
    score: +score.toFixed(4),
    phase,
    chamfer: +distance.chamfer.toFixed(4),
    hausdorff: +distance.hausdorff.toFixed(4),
    volumeIoU: +voxel.volumeIoU.toFixed(4),
    failedMust: gates.failed,
  });
  state.phase = phase;
  writeState(partDir, state);

  console.log(feedback);
  if (phase === 'done') console.log('\nALL MUST GATES PASS — this part is converged. Update notes.md with your verdict.');
}

function phaseGuidance(phase) {
  switch (phase) {
    case 'place': return 'PLACE — bbox size/center is off. Read target-profile.json bbox and fix the translate/extents before touching features.';
    case 'topology': return 'TOPOLOGY — genus or component count mismatch. Find the missing/extra hole or piece (probe section at several heights; look for isHole contours).';
    case 'silhouette': return 'SILHOUETTE — solids overlap poorly. Trace the worst view/axis (probe bands + trace2code) before tuning details.';
    case 'features': return 'FEATURES — localized blobs wrong. Work the largest finding first: probe near its centroid, identify the shape class, fix that one feature, re-run.';
    case 'tune': return 'TUNE — structure is right; nudge dimensions (or declare api.params and run the optimizer).';
    case 'done': return 'DONE — all MUST gates pass.';
    default: return phase;
  }
}

// ---------- CLI ----------

async function main() {
  const argv = process.argv;
  if (argv[2] === 'init') {
    const [partDir, targetPath] = [argv[3], argv[4]];
    if (!partDir || !targetPath) {
      console.error('Usage: node scripts/inverse-cad/turn.mjs init <partDir> <target.stl>');
      process.exit(2);
    }
    return init(partDir, targetPath);
  }
  const partDir = argv[2];
  const candidatePath = argv[3];
  let note = null;
  for (let i = 4; i < argv.length; i++) {
    if (argv[i] === '--note') note = argv[++i];
  }
  if (!partDir || !candidatePath) {
    console.error('Usage: node scripts/inverse-cad/turn.mjs <partDir> <candidate.js> --note "..."  |  turn.mjs init <partDir> <target.stl>');
    process.exit(2);
  }
  await turn(partDir, candidatePath, note);
}

main().catch((e) => {
  console.error('turn failed:', e?.stack || e?.message || e);
  process.exit(1);
});
