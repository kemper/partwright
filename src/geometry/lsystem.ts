// L-system string rewriting + a 3D turtle interpreter.
//
// An L-system (Lindenmayer system) grows a short "axiom" string into a
// long one by repeatedly substituting symbols via production `rules`, then
// a turtle walks the result laying down cylinder segments — the classic
// recipe for fractal plants, corals, and branching structures. This is the
// generative-grammar counterpart to the SDF layer's primitives: where SDF
// says "a sphere here, a torus there", an L-system says "grow".
//
// This module is PURE (no SDF / Manifold dependency) so it lives in the
// fast unit tier. `src/geometry/sdf.ts` owns the binding from segments to
// meshable capsule geometry via `api.sdf.lsystem(...)`. It is a vendored
// spike standing in for the kind of grammar @thi.ng/lsys provides.
//
// Turtle commands (Prusinkiewicz & Lindenmayer, "The Algorithmic Beauty
// of Plants"):
//   F        forward, drawing a segment
//   f        forward without drawing (a gap)
//   + -      yaw left / right        (rotate around the turtle's Up axis)
//   & ^      pitch down / up         (rotate around the turtle's Left axis)
//   \ /      roll left / right       (rotate around the turtle's Heading)
//   |        turn 180°
//   [ ]      push / pop turtle state (a branch); depth increases inside
//   !        thin the current radius by `radiusScale`
//   <leaf>   any symbol in `leafSymbols` records a leaf marker at the
//            current position (no movement) — e.g. for foliage or flowers

export type Vec3 = [number, number, number];

export interface LSystemRule {
  /** Relative weight of this production (need not sum to 1). */
  p: number;
  /** Replacement string. */
  to: string;
}

export interface LSystemSpec {
  /** Starting string. */
  axiom: string;
  /** Per-symbol productions. A plain string is deterministic; an array of
   *  `{ p, to }` picks one stochastically (weighted) per occurrence. */
  rules: Record<string, string | LSystemRule[]>;
  /** Number of rewrite passes. */
  iterations: number;
  /** Seed for stochastic rule selection (ignored if all rules are
   *  deterministic). */
  seed?: number;
}

export interface TurtleOptions {
  /** Degrees turned by each +/-/&/^/\// command. */
  angle?: number;
  /** Length of one `F` segment (before depth scaling). */
  length?: number;
  /** Starting cylinder radius. */
  radius?: number;
  /** Radius multiplier per branch depth (and per `!`). < 1 thins toward
   *  the tips for a natural taper. */
  radiusScale?: number;
  /** Length multiplier per branch depth. < 1 shortens toward the tips. */
  lengthScale?: number;
  /** Symbols that drop a leaf marker at the current position. */
  leafSymbols?: string[];
}

export interface Segment {
  a: Vec3;
  b: Vec3;
  radius: number;
  /** Bracket nesting depth at which this segment was drawn (0 = trunk). */
  depth: number;
}

export interface Leaf {
  p: Vec3;
  depth: number;
}

export interface TurtleResult {
  segments: Segment[];
  leaves: Leaf[];
}

// Safety caps — keep a runaway grammar from exhausting memory or wedging
// the mesher. These are structural guards, not user-tunable knobs.
const MAX_STRING_LENGTH = 200_000;
const MAX_SEGMENTS = 6000;

const DEG = Math.PI / 180;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Apply the production rules `iterations` times. Stochastic rules (array
 *  values) are resolved with a seeded PRNG so output is reproducible. */
export function expandLSystem(spec: LSystemSpec): string {
  const { axiom, rules, iterations } = spec;
  const rng = mulberry32(spec.seed ?? 1);

  const pick = (choices: LSystemRule[]): string => {
    let total = 0;
    for (const c of choices) total += c.p;
    if (total <= 0) return '';
    let r = rng() * total;
    for (const c of choices) {
      r -= c.p;
      if (r <= 0) return c.to;
    }
    return choices[choices.length - 1].to;
  };

  let s = axiom;
  for (let i = 0; i < iterations; i++) {
    let out = '';
    for (const ch of s) {
      const rule = rules[ch];
      if (rule === undefined) { out += ch; continue; }
      out += typeof rule === 'string' ? rule : pick(rule);
      if (out.length > MAX_STRING_LENGTH) {
        throw new Error(
          `L-system expansion exceeded ${MAX_STRING_LENGTH} characters — reduce iterations or simplify the rules.`,
        );
      }
    }
    s = out;
  }
  return s;
}

/** Rotate two orthonormal basis vectors `u` and `v` by `rad` in their
 *  shared plane (Rodrigues for an orthonormal pair). Mutates copies. */
function rotatePair(u: Vec3, v: Vec3, rad: number): [Vec3, Vec3] {
  const c = Math.cos(rad), s = Math.sin(rad);
  const nu: Vec3 = [u[0] * c + v[0] * s, u[1] * c + v[1] * s, u[2] * c + v[2] * s];
  const nv: Vec3 = [-u[0] * s + v[0] * c, -u[1] * s + v[1] * c, -u[2] * s + v[2] * c];
  return [nu, nv];
}

interface TurtleState {
  pos: Vec3;
  h: Vec3; // heading (forward)
  l: Vec3; // left
  u: Vec3; // up
  radius: number;
  length: number;
  depth: number;
}

/** Walk an expanded L-system string, emitting cylinder segments and leaf
 *  markers. The turtle starts at the origin heading +Z (grows upward). */
export function turtle3d(commands: string, opts: TurtleOptions = {}): TurtleResult {
  const angle = (opts.angle ?? 25) * DEG;
  const baseLength = opts.length ?? 8;
  const baseRadius = opts.radius ?? 1;
  const radiusScale = opts.radiusScale ?? 0.8;
  const lengthScale = opts.lengthScale ?? 1;
  const leafSet = new Set(opts.leafSymbols ?? []);

  const segments: Segment[] = [];
  const leaves: Leaf[] = [];

  let st: TurtleState = {
    pos: [0, 0, 0],
    h: [0, 0, 1],
    l: [0, 1, 0],
    u: [-1, 0, 0], // u = h × l, keeps the frame right-handed
    radius: baseRadius,
    length: baseLength,
    depth: 0,
  };
  const stack: TurtleState[] = [];

  for (const ch of commands) {
    switch (ch) {
      case 'F':
      case 'G': {
        const a = st.pos;
        const len = st.length * Math.pow(lengthScale, st.depth);
        const b: Vec3 = [a[0] + st.h[0] * len, a[1] + st.h[1] * len, a[2] + st.h[2] * len];
        const radius = st.radius * Math.pow(radiusScale, st.depth);
        segments.push({ a: [...a] as Vec3, b, radius, depth: st.depth });
        if (segments.length > MAX_SEGMENTS) {
          throw new Error(
            `L-system produced more than ${MAX_SEGMENTS} segments — reduce iterations or branch factor.`,
          );
        }
        st.pos = b;
        break;
      }
      case 'f': {
        const len = st.length * Math.pow(lengthScale, st.depth);
        st.pos = [st.pos[0] + st.h[0] * len, st.pos[1] + st.h[1] * len, st.pos[2] + st.h[2] * len];
        break;
      }
      case '+': [st.h, st.l] = rotatePair(st.h, st.l, angle); break;
      case '-': [st.h, st.l] = rotatePair(st.h, st.l, -angle); break;
      case '&': [st.h, st.u] = rotatePair(st.h, st.u, angle); break;
      case '^': [st.h, st.u] = rotatePair(st.h, st.u, -angle); break;
      case '\\': [st.l, st.u] = rotatePair(st.l, st.u, angle); break;
      case '/': [st.l, st.u] = rotatePair(st.l, st.u, -angle); break;
      case '|': [st.h, st.l] = rotatePair(st.h, st.l, Math.PI); break;
      case '!': st.radius *= radiusScale; break;
      case '[':
        stack.push({ ...st, pos: [...st.pos] as Vec3, h: [...st.h] as Vec3, l: [...st.l] as Vec3, u: [...st.u] as Vec3, depth: st.depth });
        st.depth += 1;
        break;
      case ']': {
        const popped = stack.pop();
        if (popped) st = popped;
        break;
      }
      default:
        if (leafSet.has(ch)) leaves.push({ p: [...st.pos] as Vec3, depth: st.depth });
        break;
    }
  }

  return { segments, leaves };
}
