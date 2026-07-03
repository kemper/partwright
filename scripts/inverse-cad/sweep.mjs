#!/usr/bin/env node
// sweep.mjs — run eval.mjs across a list of (target, candidate) pairs and
// print one metrics line per pair. Uses a hardcoded manifest defined in
// this file so it's dead-simple to re-run.

import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const PAIRS = [
  ['frame_hips.stl', 'hips-v2-p1.js'],
  ['frame_neck.stl', 'neck-v2-p1.js'],
  ['frame_waist.stl', 'waist-v3-p1.js'],
  ['frame_abdomen.stl', 'abdomen-v2-p1.js'],
  ['frame_head.stl', 'head-v3.js'],
  ['frame_chest.stl', 'chest-v2.js'],
  ['frame_clavicle_2x.stl', 'clavicle-v2-p1.js'],
  ['frame_hip_and_shoulder_4x.stl', 'hip_shoulder-v9.js'],
  ['frame_knee_and_elbow_4x.stl', 'knee_elbow-v2.js'],
  ['frame_ankle_2x.stl', 'ankle-v5.js'],
  ['frame_upper_arm_2x.stl', 'upper_arm-v7.js'],
  ['frame_forearm_2x.stl', 'forearm-v2.js'],
  ['frame_thigh_2x.stl', 'thigh-v4.js'],
  ['frame_shin_2x.stl', 'shin-v2.js'],
  ['adapter_stand.stl', 'adapter_stand-v2.js'],
  ['hand_fist_left.stl', 'hand_fist_left-v6.js'],
  ['hand_fist_right.stl', 'hand_fist_right-v2.js'],
  ['hand_grip_left.stl', 'hand_grip_left-v2.js'],
  ['hand_grip_right.stl', 'hand_grip_right-v2.js'],
  ['hand_open_left.stl', 'hand_open_left-v2.js'],
  ['hand_open_right.stl', 'hand_open_right-v2.js'],
];

const TARGET_DIR = resolve('.plans/inverse-cad/target-stls');
const CAND_DIR = resolve('.plans/inverse-cad/candidates');
const results = [];
for (const [t, c] of PAIRS) {
  const tp = `${TARGET_DIR}/${t}`;
  const cp = `${CAND_DIR}/${c}`;
  if (!existsSync(tp) || !existsSync(cp)) {
    console.error(`SKIP ${t} — missing target or candidate (${cp})`);
    continue;
  }
  spawnSync('node', ['scripts/inverse-cad/eval.mjs', tp, cp, '--size', '400', '--views', 'front,right,back,left,top,iso'], { encoding: 'utf8' });
  const metricsPath = `${CAND_DIR}/eval/${t.replace(/\.stl$/, '')}/metrics.json`;
  if (existsSync(metricsPath)) {
    const m = JSON.parse(readFileSync(metricsPath, 'utf8'));
    if (m.ok) {
      results.push({ target: t, candidate: c, chamfer: m.distance.chamfer, hausdorff: m.distance.hausdorff, ok: true });
      console.log(`OK   ${t.padEnd(38)} chamfer=${m.distance.chamfer.toFixed(3)} haus=${m.distance.hausdorff.toFixed(3)}`);
    } else {
      results.push({ target: t, candidate: c, ok: false, error: m.error });
      console.log(`FAIL ${t.padEnd(38)} ${m.error}`);
    }
  } else {
    console.log(`FAIL ${t.padEnd(38)} eval crashed`);
  }
}

const okList = results.filter((r) => r.ok);
if (okList.length) {
  const avg = okList.reduce((a, r) => a + r.chamfer, 0) / okList.length;
  const maxH = okList.reduce((a, r) => Math.max(a, r.hausdorff), 0);
  console.log(`\n${okList.length}/${PAIRS.length} candidates rendered — mean chamfer ${avg.toFixed(3)}mm, worst hausdorff ${maxH.toFixed(3)}mm`);
}
