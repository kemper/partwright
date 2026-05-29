// Scene code generation.
//
// generateSceneCode turns a (spec, graph) pair into a complete manifold-js
// program string that returns one composed Manifold. The emitted program:
//   • exposes `const { Manifold } = api;`
//   • declares one `function buildAsset_<id>(p) { <body> }` per asset
//   • builds a BAKE CACHE: instances sharing (assetId, paramValues) are built
//     once into `const baked_<n> = buildAsset_<id>({...literals});`
//   • places each instance by reusing its bake:
//       baked_n.scale(s).rotate([0,0,<deg>]).translate([x,y,0])
//   • optionally adds a ground slab
//   • ends with `return Manifold.compose([...placed, ground?]);`
//
// Per-instance params are emitted as LITERALS (api.params can't vary per
// instance). Asset ids are validated identifier-safe so they're safe to splice
// into a function name. Pure + dependency-free.

import type { ParamValue } from '../geometry/params';
import type { AssetSpec, SceneGraph, SceneInstance, SceneSpec } from './types';

const ID_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Serialize a single param value as a JS literal. Numbers are rounded to ~6
 *  significant digits to keep generated code compact and deterministic. */
export function paramLiteral(v: ParamValue): string {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) {
      throw new Error(`generateSceneCode: non-finite param value ${String(v)}`);
    }
    // 6 significant digits, then drop a trailing ".0"-style noise via Number().
    return String(Number(v.toPrecision(6)));
  }
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') return JSON.stringify(v);
  throw new Error(`generateSceneCode: unsupported param value type ${typeof v}`);
}

function num(v: number): string {
  if (!Number.isFinite(v)) throw new Error(`generateSceneCode: non-finite number ${String(v)}`);
  return String(Number(v.toPrecision(6)));
}

function paramObjectLiteral(values: Record<string, ParamValue>): string {
  const keys = Object.keys(values).sort();
  const parts = keys.map(k => `${JSON.stringify(k)}: ${paramLiteral(values[k])}`);
  return `{${parts.join(', ')}}`;
}

/** A stable key for grouping instances into one bake. */
function bakeKey(inst: SceneInstance): string {
  return inst.assetId + '|' + paramObjectLiteral(inst.paramValues);
}

export function generateSceneCode(spec: SceneSpec, graph: SceneGraph): string {
  const assetById = new Map<string, AssetSpec>();
  for (const a of spec.assets) {
    if (!ID_RE.test(a.id)) {
      throw new Error(`generateSceneCode: asset id "${a.id}" is not identifier-safe (must match ${ID_RE}).`);
    }
    assetById.set(a.id, a);
  }

  const lines: string[] = [];
  lines.push(`// Partwright Scene — generated from seed ${spec.seed}`);
  lines.push(`// ${graph.stats.placed} instances of ${spec.assets.length} asset(s), layout: ${spec.layout.kind}`);
  lines.push(`const { Manifold } = api;`);
  lines.push('');

  // Asset builder functions.
  for (const a of spec.assets) {
    lines.push(`function buildAsset_${a.id}(p) {`);
    lines.push(a.body);
    lines.push(`}`);
    lines.push('');
  }

  // Bake cache: one const per unique (asset, params) combo, in first-seen order.
  const bakeName = new Map<string, string>();
  let counter = 0;
  for (const inst of graph.instances) {
    const key = bakeKey(inst);
    if (bakeName.has(key)) continue;
    const name = `baked_${counter++}`;
    bakeName.set(key, name);
    const asset = assetById.get(inst.assetId);
    if (!asset) throw new Error(`generateSceneCode: instance references unknown asset "${inst.assetId}".`);
    lines.push(`const ${name} = buildAsset_${asset.id}(${paramObjectLiteral(inst.paramValues)});`);
  }
  if (graph.instances.length > 0) lines.push('');

  // Placed instances.
  const placedExprs: string[] = [];
  graph.instances.forEach((inst, i) => {
    const baked = bakeName.get(bakeKey(inst))!;
    const asset = assetById.get(inst.assetId)!;
    const baseHeight = asset.baseHeight ?? 0;
    let expr = baked;
    if (inst.scale !== 1) expr += `.scale(${num(inst.scale)})`;
    if (inst.rotationZ !== 0) expr += `.rotate([0, 0, ${num(inst.rotationZ)}])`;
    const z = baseHeight !== 0 ? baseHeight * inst.scale : 0;
    expr += `.translate([${num(inst.position[0])}, ${num(inst.position[1])}, ${num(z)}])`;
    const name = `place_${i}`;
    lines.push(`const ${name} = ${expr};`);
    placedExprs.push(name);
  });
  if (graph.instances.length > 0) lines.push('');

  // Optional ground slab.
  const ground = spec.ground;
  let groundExpr: string | null = null;
  if (ground && ground.enabled) {
    const margin = ground.margin ?? 0;
    const thickness = ground.thickness ?? 1;
    const { min, max } = graph.stats.bounds;
    const w = max[0] - min[0] + 2 * margin;
    const d = max[1] - min[1] + 2 * margin;
    const cx = (min[0] + max[0]) / 2;
    const cy = (min[1] + max[1]) / 2;
    groundExpr = `Manifold.cube([${num(w)}, ${num(d)}, ${num(thickness)}], true).translate([${num(cx)}, ${num(cy)}, ${num(-thickness / 2)}])`;
    lines.push(`const ground = ${groundExpr};`);
    lines.push('');
  }

  const composeItems = [...placedExprs];
  if (groundExpr) composeItems.push('ground');

  if (composeItems.length === 0) {
    // Degenerate scene — emit an empty manifold so the program still returns one.
    lines.push(`return Manifold.cube([0.0001, 0.0001, 0.0001], true);`);
  } else {
    lines.push(`return Manifold.compose([${composeItems.join(', ')}]);`);
  }

  return lines.join('\n');
}
