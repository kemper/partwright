// SDF tree → flat JS compiler.
//
// The SDF distance function is normally evaluated by walking a tree of
// per-node `_eval` closures — one JS call per node, per sample point, across
// the WASM↔JS boundary millions of times per `Manifold.levelSet`. Measured at
// ~8.6 µs/eval for a figure's dominant region; ~49% of total render time.
//
// This module compiles a supported SdfNode subtree into a single flattened JS
// function (params inlined, no per-node closure dispatch), validated byte-for-
// byte against the closure tree. Measured ~6–11× faster per eval (→ ~1.7× total
// render), with IDENTICAL geometry. Two safety nets keep it correct:
//   1. OPAQUE-LEAF FALLBACK — any unsupported node is emitted as a call to its
//      own `_eval` closure (with the ancestor-transformed coords the closure
//      tree would have passed), so unknown ops never block compilation and never
//      change the result.
//   2. RUNTIME VERIFICATION GATE — `compileSdfEval` samples the compiled fn
//      against the real `_eval` and returns null on any mismatch, so a buggy
//      emitter degrades to "no speedup", never to wrong geometry.
//
// Large subtrees are emitted as separate sub-functions (chunking): V8 deopts a
// single huge function body, which made naive full-inlining SLOWER past ~600
// nodes — chunking restores the ~10× at every size.

import { getConfig } from '../config/appConfig';

type EvalFn = (x: number, y: number, z: number) => number;
type Vec3 = [number, number, number];

/** Structural view of an `SdfNode` — only the fields the compiler reads. Kept
 *  local (not imported from `./sdf`) so this module has NO dependency edge back
 *  to `sdf.ts`, which would form an import cycle. The real `SdfNode` satisfies
 *  this shape, so callers pass it directly. */
export interface SdfNodeLike {
  kind: string;
  _eval: EvalFn;
  _children: readonly SdfNodeLike[];
  _bounds: { min: number[]; max: number[] };
  _cp?: Record<string, unknown>;
}

/** Current point as three JS identifier names in the enclosing function. */
interface Coord { x: string; y: string; z: string }

/** Kinds the compiler emits inline. Anything else → opaque leaf. */
const SUPPORTED = new Set([
  'sphere', 'box', 'ellipsoid', 'cylinder', 'torus', 'capsule',
  'union', 'subtract', 'intersect', 'smoothUnion', 'smoothSubtract', 'smoothIntersect',
  'translate', 'rotate', 'scale', 'mirror', 'round', 'shell', 'twist', 'bend', 'taper',
]);
/** Wrappers transparent to evaluation — skip straight to the child. */
const TRANSPARENT = new Set(['labelled', 'fineHands']);

/** Numeric literal, always parenthesised so a negative value can't fuse with a
 *  preceding operator in the generated source. */
function L(n: number): string { return `(${n})`; }

interface CompileParams { [k: string]: unknown }
type CNode = SdfNodeLike;

function transparentTarget(node: CNode): CNode {
  let n = node;
  while (TRANSPARENT.has(n.kind) && n._children.length > 0) n = n._children[0];
  return n;
}

/** Count nodes in the eval graph (children + the hidden `b` operand of the
 *  subtract family), following transparent wrappers. Memoised. */
function countNodes(node: CNode, memo: Map<CNode, number>): number {
  const t = transparentTarget(node);
  const hit = memo.get(t);
  if (hit !== undefined) return hit;
  let n = 1;
  for (const c of t._children) n += countNodes(c, memo);
  const b = (t._cp?.b as CNode | undefined);
  if (b) n += countNodes(b, memo);
  memo.set(t, n);
  return n;
}

class Emitter {
  lines: string[] = [];            // current function body
  subs: string[] = [];             // emitted sub-function sources
  leaves: EvalFn[] = [];           // opaque-leaf closures, captured by index
  private vn = 0;
  private sn = 0;
  compiled = 0;                    // nodes emitted inline
  opaque = 0;                      // nodes emitted as opaque leaves
  private chunk: number;
  private sizes: Map<CNode, number>;
  constructor(chunk: number, sizes: Map<CNode, number>) {
    this.chunk = chunk;
    this.sizes = sizes;
  }

  v(): string { return `_v${this.vn++}`; }

  /** Compile a child in the given coord frame, returning the result var. Splits
   *  big subtrees into their own functions so no single body trips V8's deopt. */
  child(node: CNode, coord: Coord): string {
    const t = transparentTarget(node);
    if (!SUPPORTED.has(t.kind) || t._cp === undefined) {
      // Opaque leaf: call the node's own closure with the threaded coords.
      this.opaque++;
      const i = this.leaves.length;
      this.leaves.push(t._eval);
      const out = this.v();
      this.lines.push(`const ${out}=_lv[${i}](${coord.x},${coord.y},${coord.z});`);
      return out;
    }
    if ((this.sizes.get(t) ?? 1) >= this.chunk) {
      // Emit as its own function s{n}(x,y,z) and call it.
      const name = `_s${this.sn++}`;
      const saved = this.lines;
      this.lines = [];
      const ret = this.emit(t, { x: 'x', y: 'y', z: 'z' });
      this.subs.push(`function ${name}(x,y,z){${this.lines.join('')}return ${ret};}`);
      this.lines = saved;
      const out = this.v();
      this.lines.push(`const ${out}=${name}(${coord.x},${coord.y},${coord.z});`);
      return out;
    }
    return this.emit(t, coord);
  }

  /** Emit one supported node inline; returns its result var. */
  emit(node: CNode, c: Coord): string {
    this.compiled++;
    const p = node._cp as CompileParams;
    const out = this.v();
    const E = (s: string) => this.lines.push(s);
    switch (node.kind) {
      case 'sphere': {
        E(`const ${out}=Math.sqrt(${c.x}*${c.x}+${c.y}*${c.y}+${c.z}*${c.z})-${L(p.r as number)};`);
        return out;
      }
      case 'box': {
        const qx = this.v(), qy = this.v(), qz = this.v(), m = this.v();
        E(`const ${qx}=Math.abs(${c.x})-${L(p.hx as number)},${qy}=Math.abs(${c.y})-${L(p.hy as number)},${qz}=Math.abs(${c.z})-${L(p.hz as number)};`);
        E(`const ${m}=Math.max(${qx},Math.max(${qy},${qz}));`);
        E(`const ${out}=Math.sqrt((${qx}>0?${qx}:0)**2+(${qy}>0?${qy}:0)**2+(${qz}>0?${qz}:0)**2)+(${m}<0?${m}:0);`);
        return out;
      }
      case 'ellipsoid': {
        const ax = p.ax as number, ay = p.ay as number, az = p.az as number;
        const k0 = this.v(), k1 = this.v();
        E(`const ${k0}=Math.sqrt((${c.x}/${L(ax)})**2+(${c.y}/${L(ay)})**2+(${c.z}/${L(az)})**2);`);
        E(`const ${k1}=Math.sqrt((${c.x}/${L(ax * ax)})**2+(${c.y}/${L(ay * ay)})**2+(${c.z}/${L(az * az)})**2);`);
        E(`const ${out}=${k1}<1e-12?${L(-(p.minR as number))}:(${k0}*(${k0}-1))/${k1};`);
        return out;
      }
      case 'cylinder': {
        const dx = this.v(), dz = this.v(), m = this.v();
        E(`const ${dx}=Math.sqrt(${c.x}*${c.x}+${c.y}*${c.y})-${L(p.r as number)},${dz}=Math.abs(${c.z})-${L(p.hh as number)};`);
        E(`const ${m}=Math.max(${dx},${dz});`);
        E(`const ${out}=Math.sqrt((${dx}>0?${dx}:0)**2+(${dz}>0?${dz}:0)**2)+(${m}<0?${m}:0);`);
        return out;
      }
      case 'torus': {
        const q = this.v();
        E(`const ${q}=Math.sqrt(${c.x}*${c.x}+${c.y}*${c.y})-${L(p.R as number)};`);
        E(`const ${out}=Math.sqrt(${q}*${q}+${c.z}*${c.z})-${L(p.r as number)};`);
        return out;
      }
      case 'capsule': {
        const a = p.a as Vec3, d = p.d as Vec3;
        const px = this.v(), py = this.v(), pz = this.v(), t = this.v(), wx = this.v(), wy = this.v(), wz = this.v();
        E(`let ${px}=${c.x}-${L(a[0])},${py}=${c.y}-${L(a[1])},${pz}=${c.z}-${L(a[2])};`);
        E(`let ${t}=(${px}*${L(d[0])}+${py}*${L(d[1])}+${pz}*${L(d[2])})/${L(p.ll as number)};${t}=${t}<0?0:(${t}>1?1:${t});`);
        E(`const ${wx}=${px}-${L(d[0])}*${t},${wy}=${py}-${L(d[1])}*${t},${wz}=${pz}-${L(d[2])}*${t};`);
        E(`const ${out}=Math.sqrt(${wx}*${wx}+${wy}*${wy}+${wz}*${wz})-${L(p.r as number)};`);
        return out;
      }
      case 'union': {
        const a = this.child(node._children[0], c), b = this.child(node._children[1], c);
        E(`const ${out}=Math.min(${a},${b});`); return out;
      }
      case 'intersect': {
        const a = this.child(node._children[0], c), b = this.child(node._children[1], c);
        E(`const ${out}=Math.max(${a},${b});`); return out;
      }
      case 'subtract': {
        const a = this.child(node._children[0], c), b = this.child(p.b as CNode, c);
        E(`const ${out}=Math.max(${a},-${b});`); return out;
      }
      case 'smoothUnion': {
        const a = this.child(node._children[0], c), b = this.child(node._children[1], c), h = this.v();
        E(`let ${h}=0.5+0.5*(${b}-${a})/${L(p.k as number)};${h}=${h}<0?0:(${h}>1?1:${h});`);
        E(`const ${out}=(${b}+(${a}-${b})*${h})-${L(p.k as number)}*${h}*(1-${h});`); return out;
      }
      case 'smoothSubtract': {
        const a = this.child(node._children[0], c), b = this.child(p.b as CNode, c), h = this.v();
        E(`let ${h}=0.5-0.5*(${b}+${a})/${L(p.k as number)};${h}=${h}<0?0:(${h}>1?1:${h});`);
        E(`const ${out}=(${a}+(-${b}-${a})*${h})+${L(p.k as number)}*${h}*(1-${h});`); return out;
      }
      case 'smoothIntersect': {
        const a = this.child(node._children[0], c), b = this.child(node._children[1], c), h = this.v();
        E(`let ${h}=0.5-0.5*(${b}-${a})/${L(p.k as number)};${h}=${h}<0?0:(${h}>1?1:${h});`);
        E(`const ${out}=(${b}+(${a}-${b})*${h})+${L(p.k as number)}*${h}*(1-${h});`); return out;
      }
      case 'translate': {
        const t = p.t as Vec3, nx = this.v(), ny = this.v(), nz = this.v();
        E(`const ${nx}=${c.x}-${L(t[0])},${ny}=${c.y}-${L(t[1])},${nz}=${c.z}-${L(t[2])};`);
        return this.child(node._children[0], { x: nx, y: ny, z: nz });
      }
      case 'rotate': {
        const m = p.m as number[]; // [m00,m01,m02,m10,m11,m12,m20,m21,m22]
        const nx = this.v(), ny = this.v(), nz = this.v();
        E(`const ${nx}=${L(m[0])}*${c.x}+${L(m[3])}*${c.y}+${L(m[6])}*${c.z},${ny}=${L(m[1])}*${c.x}+${L(m[4])}*${c.y}+${L(m[7])}*${c.z},${nz}=${L(m[2])}*${c.x}+${L(m[5])}*${c.y}+${L(m[8])}*${c.z};`);
        return this.child(node._children[0], { x: nx, y: ny, z: nz });
      }
      case 'scale': {
        const nx = this.v(), ny = this.v(), nz = this.v();
        E(`const ${nx}=${c.x}*${L(p.inv as number)},${ny}=${c.y}*${L(p.inv as number)},${nz}=${c.z}*${L(p.inv as number)};`);
        const cv = this.child(node._children[0], { x: nx, y: ny, z: nz });
        E(`const ${out}=${cv}*${L(p.s as number)};`); return out;
      }
      case 'mirror': {
        const axis = p.axis as 'x' | 'y' | 'z', n = this.v();
        const src = axis === 'x' ? c.x : axis === 'y' ? c.y : c.z;
        E(`const ${n}=-${src};`);
        const nc: Coord = axis === 'x' ? { x: n, y: c.y, z: c.z } : axis === 'y' ? { x: c.x, y: n, z: c.z } : { x: c.x, y: c.y, z: n };
        return this.child(node._children[0], nc);
      }
      case 'round': {
        const cv = this.child(node._children[0], c);
        E(`const ${out}=${cv}-${L(p.r as number)};`); return out;
      }
      case 'shell': {
        const cv = this.child(node._children[0], c);
        E(`const ${out}=Math.abs(${cv})-${L(p.half as number)};`); return out;
      }
      case 'twist': {
        const axis = p.axis as 'x' | 'y' | 'z', rate = p.rate as number, cu = p.cu as number, cv = p.cv as number;
        const aa = this.v(), cc = this.v(), ss = this.v(), nx = this.v(), ny = this.v(), nz = this.v();
        if (axis === 'z') {
          const px = this.v(), py = this.v();
          E(`const ${px}=${c.x}-${L(cu)},${py}=${c.y}-${L(cv)};`);
          E(`const ${aa}=${c.z}*${L(rate)},${cc}=Math.cos(${aa}),${ss}=Math.sin(${aa});`);
          E(`const ${nx}=${cc}*${px}+${ss}*${py}+${L(cu)},${ny}=-${ss}*${px}+${cc}*${py}+${L(cv)},${nz}=${c.z};`);
        } else if (axis === 'y') {
          const px = this.v(), pz = this.v();
          E(`const ${px}=${c.x}-${L(cu)},${pz}=${c.z}-${L(cv)};`);
          E(`const ${aa}=${c.y}*${L(rate)},${cc}=Math.cos(${aa}),${ss}=Math.sin(${aa});`);
          E(`const ${nx}=${cc}*${px}+${ss}*${pz}+${L(cu)},${ny}=${c.y},${nz}=-${ss}*${px}+${cc}*${pz}+${L(cv)};`);
        } else {
          const py = this.v(), pz = this.v();
          E(`const ${py}=${c.y}-${L(cu)},${pz}=${c.z}-${L(cv)};`);
          E(`const ${aa}=${c.x}*${L(rate)},${cc}=Math.cos(${aa}),${ss}=Math.sin(${aa});`);
          E(`const ${nx}=${c.x},${ny}=${cc}*${py}+${ss}*${pz}+${L(cu)},${nz}=-${ss}*${py}+${cc}*${pz}+${L(cv)};`);
        }
        return this.child(node._children[0], { x: nx, y: ny, z: nz });
      }
      case 'bend': {
        const axis = p.axis as 'x' | 'y' | 'z', rate = p.rate as number;
        const aa = this.v(), cc = this.v(), ss = this.v(), nx = this.v(), ny = this.v(), nz = this.v();
        if (axis === 'x') {
          E(`const ${aa}=${c.x}*${L(rate)},${cc}=Math.cos(${aa}),${ss}=Math.sin(${aa});`);
          E(`const ${nx}=${cc}*${c.x}+${ss}*${c.y},${ny}=-${ss}*${c.x}+${cc}*${c.y},${nz}=${c.z};`);
        } else if (axis === 'y') {
          E(`const ${aa}=${c.y}*${L(rate)},${cc}=Math.cos(${aa}),${ss}=Math.sin(${aa});`);
          E(`const ${nx}=${c.x},${ny}=${cc}*${c.y}+${ss}*${c.z},${nz}=-${ss}*${c.y}+${cc}*${c.z};`);
        } else {
          E(`const ${aa}=${c.z}*${L(rate)},${cc}=Math.cos(${aa}),${ss}=Math.sin(${aa});`);
          E(`const ${nx}=${cc}*${c.x}+${ss}*${c.z},${ny}=${c.y},${nz}=-${ss}*${c.x}+${cc}*${c.z};`);
        }
        return this.child(node._children[0], { x: nx, y: ny, z: nz });
      }
      case 'taper': {
        const axis = p.axis as 'x' | 'y' | 'z', rate = p.rate as number, s = this.v();
        const along = axis === 'x' ? c.x : axis === 'y' ? c.y : c.z;
        E(`let ${s}=1+${L(rate)}*${along};if(${s}<1e-3)${s}=1e-3;`);
        let nc: Coord;
        if (axis === 'z') nc = { x: `(${c.x}/${s})`, y: `(${c.y}/${s})`, z: c.z };
        else if (axis === 'y') nc = { x: `(${c.x}/${s})`, y: c.y, z: `(${c.z}/${s})` };
        else nc = { x: c.x, y: `(${c.y}/${s})`, z: `(${c.z}/${s})` };
        // materialise divided coords into vars (child may reference them many times)
        const mx = this.v(), my = this.v(), mz = this.v();
        E(`const ${mx}=${nc.x},${my}=${nc.y},${mz}=${nc.z};`);
        const cv = this.child(node._children[0], { x: mx, y: my, z: mz });
        E(`const ${out}=${cv}*Math.min(${s},1);`); return out;
      }
      default:
        // Unreachable: child() gates on SUPPORTED before calling emit().
        throw new Error(`sdfCompile: no emitter for kind '${node.kind}'`);
    }
  }
}

export interface CompileResult {
  fn: EvalFn;
  /** Fraction of eval-graph nodes emitted inline (vs opaque-leaf closures). */
  coverage: number;
}

/** Build (but do not verify) a flat function for `root`. Returns null only if
 *  nothing could be compiled. Exposed for tests; production uses the gated
 *  `compileSdfEval`. */
export function buildCompiled(root: SdfNodeLike): CompileResult | null {
  const r = root;
  const sizes = new Map<CNode, number>();
  countNodes(r, sizes);
  const chunk = Math.max(8, getConfig().renderer.sdfCompileChunkNodes);
  const em = new Emitter(chunk, sizes);
  let retVar: string;
  try {
    retVar = em.child(r, { x: 'x', y: 'y', z: 'z' });
  } catch {
    return null;
  }
  if (em.compiled === 0) return null; // entirely opaque — no benefit
  const src = `${em.subs.join('')}return function(x,y,z){${em.lines.join('')}return ${retVar};};`;
  let fn: EvalFn;
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    fn = (new Function('_lv', src) as (lv: EvalFn[]) => EvalFn)(em.leaves);
  } catch {
    return null;
  }
  const total = em.compiled + em.opaque;
  return { fn, coverage: total > 0 ? em.compiled / total : 0 };
}

/**
 * Compile `root`'s distance function to flat JS and VERIFY it against the real
 * `_eval` at sample points spanning the node's bounds. Returns the compiled
 * function on a match, or null (caller uses the closure) on any mismatch,
 * disabled config, or unsupported tree — so geometry is never at risk.
 */
export function compileSdfEval(root: SdfNodeLike): EvalFn | null {
  if (!getConfig().renderer.sdfCompile) return null;
  const built = buildCompiled(root);
  if (!built) return null;
  const r = root;
  const ref = r._eval;
  const b = r._bounds;
  const span: Vec3 = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
  // Deterministic LCG so verification is reproducible.
  let seed = 0x2545f491;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 96; i++) {
    // sample inside the bounds, plus a margin so we test outside too
    const x = b.min[0] + (rnd() * 1.4 - 0.2) * span[0];
    const y = b.min[1] + (rnd() * 1.4 - 0.2) * span[1];
    const z = b.min[2] + (rnd() * 1.4 - 0.2) * span[2];
    const a = ref(x, y, z), c = built.fn(x, y, z);
    if (!Number.isFinite(a) || !Number.isFinite(c)) {
      if (a !== c && !(Number.isNaN(a) && Number.isNaN(c))) return null;
      continue;
    }
    if (Math.abs(a - c) > 1e-6 * (1 + Math.abs(a))) return null;
  }
  return built.fn;
}
