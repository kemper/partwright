// Creature feature kit — `api.sdf.creature`.
//
// The humanoid rig in `api.sdf.figure` can't express a creature (a big-eyed
// gremlin, a mascot, a bat-eared cat, a toy monster), so those are hand-built
// from ellipsoid masses + smoothUnion. That part goes fine; what reliably goes
// wrong is the DETAIL, the features that make a creature read as "sculpted"
// instead of "primitive soup". Each helper here encodes one recipe that took
// several render passes to get right (distilled from the Ned figurine,
// examples/creature_ned.js):
//
//   eyes   — a steep-walled aperture cut into the skin + a raised lid rim + an
//            optional hooded upper lid + an eyeball CLIPPED to the opening. The
//            steep wall crosses the eyeball at an angle, so the eye edge meshes
//            crisp (a socket ellipsoid nearly parallel to the eyeball grazes it
//            and stair-steps), and the clip stops the eyeball poking out the
//            side of a narrow skull.
//   crease — a groove (mouth line, philtrum, fold, toe split) SEATED on the real
//            built surface via surfacePoint, so it never floats off the face or
//            tunnels through to the back of the head.
//   ears   — a cupped membrane ear: a sphere SHELL clipped to a tapered leaf
//            outline (constant thickness, concave face forward), with an inner
//            membrane + raised veins as a separate paint label.
//   feet   — a long flat foot with toe pads, toe-split creases and claws.
//   hands  — a small relaxed hanging hand (palm + tapered fingers + thumb).
//   build  — attaches every feature in order, flattens the soles onto the
//            ground, labels the skin, collects every feature's detail sphere and
//            meshes it all in one call.
//
// Every feature is MIRRORED by default (model the +X side, get both), and every
// feature carries its own `detail` spheres, so the fine meshing that eyes /
// fingers / claws need comes for free in `build`.
//
// Layering: like sdfFigure, this file imports nothing from ./sdf. It receives
// the namespace structurally and is wired in by `createSdfNamespace`.

import {
  assertNumber,
  assertNumberTuple,
  assertBoolean,
  assertObject,
  assertArray,
  assertString,
  assertNoUnknownKeys,
  ValidationError,
} from '../validation/apiValidation';
import { surfacePoint, type Vec3, type Node as FigureNode } from './sdfFigure';

const DEG = Math.PI / 180;
const DOC = 'See /ai/creature.md';

/** The SDF node surface this layer uses (SdfNode satisfies it structurally). */
interface Node extends FigureNode {
  union(o: Node): Node;
  smoothUnion(o: Node, k: number): Node;
  smoothSubtract(o: Node, k: number): Node;
  smoothIntersect(o: Node, k: number): Node;
  intersect(o: Node): Node;
  translate(t: Vec3 | number, ty?: number, tz?: number): Node;
  rotate(r: Vec3 | number, ry?: number, rz?: number): Node;
  mirror(axis: 'x' | 'y' | 'z'): Node;
  shell(thickness: number): Node;
  label(name: string): Node;
  build(opts?: object): unknown;
}

/** The slice of the public SDF namespace the creature kit composes from. */
export interface CreatureSdfApi {
  sphere(radius: number): Node;
  ellipsoid(rx: number, ry: number, rz: number): Node;
  box(size: Vec3 | number): Node;
  capsule(a: Vec3, b: Vec3, radius: number): Node;
  tube(path: Vec3[], radius: number, opts?: object): Node;
  union(...nodes: Node[]): Node;
}

interface DetailSphere { center: Vec3; radius: number; edgeLength: number }

/** What every feature builder returns. `attach(skin)` blends/cuts the feature
 *  into the skin; `parts` are separately-labelled hard parts (eyeballs, inner
 *  ears, claws) to hard-union at the top level; `detail` are the refinement
 *  spheres the feature needs. `build` uses all three. */
interface CreatureFeature {
  readonly kind: 'creature-feature';
  readonly name: string;
  /** Sole height, for features that stand on the ground (feet). */
  readonly ground?: number;
  attach(skin: Node): Node;
  parts: Node[];
  detail: DetailSphere[];
}

export interface CreatureNamespace {
  /** Eyes set in steep-walled apertures with lid rims (+ optional hood). `at`
   *  is the +X eyeball centre; mirrored by default. */
  eyes(opts: object): CreatureFeature;
  /** Cupped membrane ears with a labelled inner membrane + veins. `root` is
   *  where the +X ear meets the head; mirrored by default. */
  ears(opts: object): CreatureFeature;
  /** Long flat feet with toe pads, toe splits and claws, soles on `ground`. */
  feet(opts: object): CreatureFeature;
  /** Small relaxed hanging hands (palm + fingers + thumb). */
  hands(opts: object): CreatureFeature;
  /** Carve a soft groove along `path`, seated on `surface`'s real outer face.
   *  Returns the carved surface. */
  crease(surface: Node, path: unknown[], opts?: object): Node;
  /** Attach features, flatten soles, label + mesh the whole creature. Returns
   *  the built Manifold. */
  build(opts: object): unknown;
}

// --- small helpers --------------------------------------------------------

// `null` reads as "use the default", like `undefined`.
function num(v: unknown, def: number, name: string, min?: number, max?: number, integer = false): number {
  if (v === undefined || v === null) return def;
  return assertNumber(v, name, { min, max, integer }) as number;
}
function int(v: unknown, def: number, name: string, min: number, max: number): number {
  return num(v, def, name, min, max, true);
}
function bool(v: unknown, def: boolean, name: string): boolean {
  if (v === undefined || v === null) return def;
  return assertBoolean(v, name) as boolean;
}
function str(v: unknown, def: string, name: string): string {
  if (v === undefined || v === null) return def;
  return assertString(v, name) as string;
}
function opts(v: unknown, name: string, allowed: readonly string[]): Record<string, unknown> {
  const o = (assertObject(v, name, { optional: true }) ?? {}) as Record<string, unknown>;
  assertNoUnknownKeys(o, allowed, name);
  return o;
}
function point3(v: unknown, name: string): Vec3 {
  return assertNumberTuple(v, 3, name) as Vec3;
}
function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
function spread(n: number, i: number): number { return n === 1 ? 0.5 : i / (n - 1); }

/** Rotate a point the way `node.rotate(rx, ry, rz)` rotates geometry
 *  (X, then Y, then Z — Manifold's convention). */
function rotatePoint(p: Vec3, r: Vec3): Vec3 {
  let [x, y, z] = p;
  const [ax, ay, az] = [r[0] * DEG, r[1] * DEG, r[2] * DEG];
  [y, z] = [y * Math.cos(ax) - z * Math.sin(ax), y * Math.sin(ax) + z * Math.cos(ax)];
  [x, z] = [x * Math.cos(ay) + z * Math.sin(ay), -x * Math.sin(ay) + z * Math.cos(ay)];
  [x, y] = [x * Math.cos(az) - y * Math.sin(az), x * Math.sin(az) + y * Math.cos(az)];
  return [x, y, z];
}
function add(a: Vec3, b: Vec3): Vec3 { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }

const mirrorNode = (n: Node, on: boolean): Node => (on ? n.union(n.mirror('x')) : n);
const mirrorDetail = (d: DetailSphere[], on: boolean): DetailSphere[] =>
  on ? [...d, ...d.filter((s) => Math.abs(s.center[0]) > 1e-6)
    .map((s) => ({ ...s, center: [-s.center[0], s.center[1], s.center[2]] as Vec3 }))] : d;

function feature(name: string, attach: (skin: Node) => Node, parts: Node[], detail: DetailSphere[], ground?: number): CreatureFeature {
  return ground === undefined
    ? { kind: 'creature-feature', name, attach, parts, detail }
    : { kind: 'creature-feature', name, attach, parts, detail, ground };
}

function isFeature(v: unknown): v is CreatureFeature {
  return !!v && typeof v === 'object' && (v as { kind?: unknown }).kind === 'creature-feature';
}

function assertNode(v: unknown, name: string): Node {
  const n = v as Node | undefined;
  if (!n || typeof n !== 'object' || typeof n.evaluate !== 'function' || typeof n.smoothUnion !== 'function') {
    throw new ValidationError(`${name} must be an SDF node (e.g. api.sdf.ellipsoid(10, 8, 9)). ${DOC}`);
  }
  return n;
}

// --- eyes -----------------------------------------------------------------

const EYE_KEYS = ['at', 'radius', 'aspect', 'opening', 'rim', 'hood', 'tilt', 'yaw', 'label', 'mirror', 'edgeLength'] as const;

function buildEyes(sdf: CreatureSdfApi, raw: unknown): CreatureFeature {
  const o = opts(raw, 'creature.eyes(opts)', EYE_KEYS);
  if (o.at === undefined) throw new ValidationError(`creature.eyes: 'at' (the +X eyeball centre [x, y, z]) is required. ${DOC}`);
  const at = point3(o.at, 'creature.eyes.at');
  const r = num(o.radius, 6, 'creature.eyes.radius', 0.1);
  const aspect = (o.aspect === undefined || o.aspect === null ? [1.06, 0.98, 1] : assertNumberTuple(o.aspect, 3, 'creature.eyes.aspect')) as Vec3;
  if (aspect.some((a) => !(a > 0))) throw new ValidationError(`creature.eyes.aspect must be three positive multipliers, got [${aspect.join(', ')}]. ${DOC}`);
  const opening = num(o.opening, 0.85, 'creature.eyes.opening', 0.3, 0.98);
  const rim = num(o.rim, 1, 'creature.eyes.rim', 0, 3);
  const hood = num(o.hood, 0.7, 'creature.eyes.hood', 0, 2);
  const tilt = num(o.tilt, 0, 'creature.eyes.tilt', -60, 60);
  const yaw = num(o.yaw, 0, 'creature.eyes.yaw', -60, 60);
  const label = str(o.label, 'eyes', 'creature.eyes.label');
  const mirror = bool(o.mirror, true, 'creature.eyes.mirror');
  const edge = num(o.edgeLength, Math.max(0.08, r * 0.02), 'creature.eyes.edgeLength', 0.02);

  const [ax, ay, az] = [r * aspect[0], r * aspect[1], r * aspect[2]];
  const rot: Vec3 = [0, tilt, yaw];
  // Local frame: eyeball centre at the origin, looking −Y. `tilt` rolls about
  // the view axis (+ drops the outer corner of the +X eye); `yaw` turns it out.
  const place = (n: Node): Node => mirrorNode(n.rotate(rot).translate(at), mirror);
  const ball = sdf.ellipsoid(ax, ay, az);
  // The aperture runs deep along the view axis → its wall crosses the eyeball
  // steeply, which meshes a crisp eye edge.
  const aperture = sdf.ellipsoid(ax * opening, ay * 1.4, az * opening).translate(0, -ay * 1.2, 0);
  const clip = sdf.ellipsoid(ax, ay * 1.4, az).translate(0, -ay * 1.2, 0);
  const eyeball = place(ball.intersect(clip)).label(label);

  const rimNode = rim > 0 ? place(sdf.ellipsoid(ax * 1.1, ay * 0.54 * rim, az * 1.15).translate(0, -ay * 0.54, 0)) : null;
  const hoodNode = hood > 0
    ? place(sdf.ellipsoid(ax * 1.12, ay * 0.62, az * 0.58 * hood).rotate(0, -10, 0).translate(0, -ay * 0.48, az * 0.73))
    : null;
  const cut = place(aperture);

  const attach = (skin: Node): Node => {
    let s = skin;
    if (rimNode) s = s.smoothUnion(rimNode, r * 0.68);
    if (hoodNode) s = s.smoothUnion(hoodNode, r * 0.6);
    return s.smoothSubtract(cut, r * 0.12);
  };
  const center = add(at, rotatePoint([0, -ay * 0.55, 0], rot));
  return feature('eyes', attach, [eyeball], mirrorDetail([{ center, radius: r * 1.1, edgeLength: edge }], mirror));
}

// --- ears -----------------------------------------------------------------

const EAR_KEYS = ['root', 'length', 'width', 'cup', 'thickness', 'lift', 'sweep', 'veins', 'inner', 'innerLabel', 'mirror', 'blend', 'edgeLength'] as const;

function buildEars(sdf: CreatureSdfApi, raw: unknown): CreatureFeature {
  const o = opts(raw, 'creature.ears(opts)', EAR_KEYS);
  if (o.root === undefined) throw new ValidationError(`creature.ears: 'root' (where the +X ear meets the head) is required. ${DOC}`);
  const root = point3(o.root, 'creature.ears.root');
  const L = num(o.length, 30, 'creature.ears.length', 1);
  const W = num(o.width, L * 0.68, 'creature.ears.width', 0.5);
  const cup = num(o.cup, 1, 'creature.ears.cup', 0.2, 3);
  const t = num(o.thickness, Math.max(0.8, L * 0.045), 'creature.ears.thickness', 0.2);
  const lift = num(o.lift, 16, 'creature.ears.lift', -90, 90);
  const sweep = num(o.sweep, 12, 'creature.ears.sweep', -90, 90);
  const veins = int(o.veins, 3, 'creature.ears.veins', 0, 9);
  const inner = bool(o.inner, true, 'creature.ears.inner');
  const innerLabel = str(o.innerLabel, 'innerEar', 'creature.ears.innerLabel');
  const mirror = bool(o.mirror, true, 'creature.ears.mirror');
  const blend = num(o.blend, t * 1.6, 'creature.ears.blend', 0);
  const edge = num(o.edgeLength, Math.max(0.1, t * 0.18), 'creature.ears.edgeLength', 0.02);

  // Local frame: the ear runs +X from its root, membrane in the XZ plane, the
  // cup's concave face toward −Y (forward). A sphere SHELL clipped to a tapered
  // leaf outline gives a constant-thickness curved membrane.
  const half = W / 2;
  const cupR = (L * 0.49) / cup;
  const cupC: Vec3 = [L * 0.45, -cupR, 0];
  const keepBack = sdf.box([L * 3, half, L * 3]).translate(0, half / 6, 0);
  const outline = sdf.tube([[-L * 0.09, 0, 0], [L * 0.45, 0, half * 0.07], [L, 0, half * 0.2]], half, { taper: 0.05 });
  const skinEar = sdf.sphere(cupR).translate(cupC).shell(t).smoothIntersect(outline, t * 0.5).intersect(keepBack);
  const rot: Vec3 = [0, -lift, sweep];
  const place = (n: Node): Node => mirrorNode(n.rotate(rot).translate(root), mirror);

  const parts: Node[] = [];
  if (inner) {
    const innerOutline = sdf.tube([[0, 0, 0], [L * 0.45, 0, half * 0.07], [L - t * 1.6, 0, half * 0.2]], Math.max(half - t * 1.25, half * 0.5), { taper: 0.06 });
    // The membrane's back half sits INSIDE the ear shell (a ~0.5 t overlap).
    // A thin overlap between two separately-meshed, near-parallel surfaces
    // flickers through itself at a coarse grid and the hard union fills with
    // tiny tunnels (genus in the hundreds).
    let membrane = sdf.sphere(cupR - t * 0.4).translate(cupC).shell(t * 0.8).smoothIntersect(innerOutline, t * 0.38).intersect(keepBack);
    if (veins > 0) {
      // Veins are chunky (≥ ~1.5 grid cells across at the usual 0.5–0.8 grid)
      // and smooth-welded into the membrane: thin hard-unioned strips march into
      // a tangle of tiny handles (genus in the hundreds) at a coarse grid.
      const veinShell = sdf.sphere(cupR - t * 0.9).translate(cupC).shell(t * 0.6);
      for (let i = 0; i < veins; i++) {
        const ang = veins === 1 ? 0 : lerp(-15, 15, spread(veins, i));
        const fan = sdf.box([L, L, t]).translate(L / 2, 0, 0).rotate(0, -ang, 0).translate(t * 0.6, 0, 0);
        membrane = membrane.smoothUnion(fan.intersect(veinShell).intersect(innerOutline), t * 0.3);
      }
    }
    parts.push(place(membrane).label(innerLabel));
  }
  const ear = place(skinEar);
  const center = add(root, rotatePoint([L * 0.5, 0, 0], rot));
  return feature('ears', (skin) => skin.smoothUnion(ear, blend), parts,
    mirrorDetail([{ center, radius: L * 0.58, edgeLength: edge }], mirror));
}

// --- feet -----------------------------------------------------------------

const FOOT_KEYS = ['at', 'ground', 'length', 'width', 'height', 'toes', 'claws', 'clawLabel', 'yaw', 'mirror', 'blend', 'edgeLength'] as const;

function buildFeet(sdf: CreatureSdfApi, raw: unknown): CreatureFeature {
  const o = opts(raw, 'creature.feet(opts)', FOOT_KEYS);
  if (o.at === undefined) throw new ValidationError(`creature.feet: 'at' (the +X ankle point [x, y] on the ground) is required. ${DOC}`);
  const at2 = assertNumberTuple(o.at, 2, 'creature.feet.at');
  const ground = num(o.ground, 0, 'creature.feet.ground');
  const L = num(o.length, 36, 'creature.feet.length', 1);
  const W = num(o.width, L * 0.6, 'creature.feet.width', 0.5);
  const H = num(o.height, L * 0.28, 'creature.feet.height', 0.5);
  const toes = int(o.toes, 3, 'creature.feet.toes', 0, 6);
  const claws = bool(o.claws, true, 'creature.feet.claws');
  const clawLabel = o.clawLabel === undefined ? null : str(o.clawLabel, '', 'creature.feet.clawLabel');
  const yaw = num(o.yaw, 14, 'creature.feet.yaw', -90, 90);
  const mirror = bool(o.mirror, true, 'creature.feet.mirror');
  const blend = num(o.blend, Math.min(W, H) * 0.4, 'creature.feet.blend', 0);
  const sx = W / 22, sy = L / 36, sz = H / 10, sm = Math.min(sx, sy, sz);
  const edge = num(o.edgeLength, Math.max(0.08, 0.3 * sm), 'creature.feet.edgeLength', 0.02);
  const E = (rx: number, ry: number, rz: number, x: number, y: number, z: number) =>
    sdf.ellipsoid(rx * sx, ry * sy, rz * sz).translate(x * sx, y * sy, z * sz);

  // Local frame: ankle over the origin, toes toward −Y, sole at z = 0 (the
  // body is flattened onto `ground` in build()).
  let foot = E(11, 18, 6, 0, -10, 4).smoothUnion(E(7.5, 7, 6.5, 0, 3, 5), 4 * sm);
  const toeX = (i: number) => lerp(-6.05, 6.05, spread(toes, i));
  for (let i = 0; i < toes; i++) foot = foot.smoothUnion(E(3.8, 4.8, 3.6, toeX(i), -24.5, 3.2), 1.5 * sm);
  for (let i = 0; i + 1 < toes; i++) {
    const x = (toeX(i) + toeX(i + 1)) / 2 * sx;
    foot = foot.smoothSubtract(sdf.capsule([x, -30 * sy, 7 * sz], [x, -23 * sy, 6.5 * sz], 0.7 * sm), 0.6 * sm);
  }
  const rot: Vec3 = [0, 0, yaw];
  const at: Vec3 = [at2[0], at2[1], ground];
  const place = (n: Node): Node => mirrorNode(n.rotate(rot).translate(at), mirror);
  const footW = place(foot);
  let clawW: Node | null = null;
  if (claws && toes > 0) {
    const cs: Node[] = [];
    for (let i = 0; i < toes; i++) {
      const x = toeX(i) * sx, out = lerp(-0.6, 0.6, spread(toes, i)) * sx;
      cs.push(sdf.tube([[x, -27 * sy, 1.6 * sz], [x + out, -30.6 * sy, 0.9 * sz]], 1.05 * sm, { taper: 0.2 }));
    }
    clawW = place(sdf.union(...cs));
  }
  const parts = clawW && clawLabel ? [clawW.label(clawLabel)] : [];
  const attach = (skin: Node): Node => {
    const s = skin.smoothUnion(footW, blend);
    return clawW && !clawLabel ? s.union(clawW) : s;
  };
  const center = add(at, rotatePoint([0, -27 * sy, 3 * sz], rot));
  return feature('feet', attach, parts, mirrorDetail([{ center, radius: 10 * Math.max(sx, sy), edgeLength: edge }], mirror), ground);
}

// --- hands ----------------------------------------------------------------

const HAND_KEYS = ['at', 'size', 'fingers', 'thumb', 'yaw', 'mirror', 'blend', 'edgeLength'] as const;

function buildHands(sdf: CreatureSdfApi, raw: unknown): CreatureFeature {
  const o = opts(raw, 'creature.hands(opts)', HAND_KEYS);
  if (o.at === undefined) throw new ValidationError(`creature.hands: 'at' (the +X palm centre, just below the wrist) is required. ${DOC}`);
  const at = point3(o.at, 'creature.hands.at');
  const s = num(o.size, 1, 'creature.hands.size', 0.05);
  const n = int(o.fingers, 3, 'creature.hands.fingers', 1, 5);
  const thumb = bool(o.thumb, true, 'creature.hands.thumb');
  const yaw = num(o.yaw, 0, 'creature.hands.yaw', -180, 180);
  const mirror = bool(o.mirror, true, 'creature.hands.mirror');
  const blend = num(o.blend, 2 * s, 'creature.hands.blend', 0);
  const edge = num(o.edgeLength, Math.max(0.06, 0.3 * s), 'creature.hands.edgeLength', 0.02);

  // Local frame: palm centre at the origin, fingers hanging toward −Z and
  // curling slightly forward (−Y); the thumb sits forward on the inner (−X) side.
  let hand = sdf.ellipsoid(3.4 * s, 3 * s, 4.4 * s);
  for (let i = 0; i < n; i++) {
    const t = spread(n, i), bow = Math.sin(Math.PI * t);
    const a: Vec3 = [lerp(-2, 2.8, t) * s, -(1.4 + 1.2 * bow) * s, -2 * s];
    const b: Vec3 = [lerp(-3, 3.5, t) * s, -(3 + 2 * bow) * s, -6 * s];
    hand = hand.smoothUnion(sdf.tube([a, b], 1.7 * s, { taper: 0.55 }), 0.9 * s);
  }
  if (thumb) hand = hand.smoothUnion(sdf.tube([[-2.2 * s, -1.5 * s, 1 * s], [-3 * s, -3.8 * s, -1.5 * s]], 1.3 * s, { taper: 0.6 }), 0.8 * s);
  const placed = mirrorNode(hand.rotate(0, 0, yaw).translate(at), mirror);
  const center = add(at, rotatePoint([0, -1 * s, -2.5 * s], [0, 0, yaw]));
  return feature('hands', (skin) => skin.smoothUnion(placed, blend), [],
    mirrorDetail([{ center, radius: 7 * s, edgeLength: edge }], mirror));
}

// --- crease ---------------------------------------------------------------

const CREASE_KEYS = ['radius', 'depth', 'soft', 'dir'] as const;

function crease(sdf: CreatureSdfApi, surfaceIn: unknown, pathIn: unknown, raw: unknown): Node {
  const surface = assertNode(surfaceIn, 'creature.crease(surface)');
  const path = assertArray(pathIn, 'creature.crease(path)');
  if (path.length < 2) throw new ValidationError(`creature.crease(path) needs at least 2 points. ${DOC}`);
  const o = opts(raw, 'creature.crease(opts)', CREASE_KEYS);
  const radius = num(o.radius, 0.8, 'creature.crease.radius', 0.02);
  const depth = num(o.depth, radius * 0.75, 'creature.crease.depth', -radius * 3, radius * 4);
  const soft = num(o.soft, radius * 1.5, 'creature.crease.soft', 0);
  const dirRaw = (o.dir === undefined ? [0, -1, 0] : assertNumberTuple(o.dir, 3, 'creature.crease.dir')) as Vec3;
  const dl = Math.hypot(dirRaw[0], dirRaw[1], dirRaw[2]);
  if (dl < 1e-9) throw new ValidationError(`creature.crease.dir must be a non-zero vector. ${DOC}`);
  const dir: Vec3 = [dirRaw[0] / dl, dirRaw[1] / dl, dirRaw[2] / dl];
  const isY = Math.abs(dir[0]) < 1e-9 && Math.abs(dir[2]) < 1e-9;
  const b = surface.bounds();
  const mid: Vec3 = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
  const halfDiag = Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) / 2;
  const seated = path.map((p, i) => {
    const arr = assertArray(p, `creature.crease(path[${i}])`);
    let q: Vec3;
    if (arr.length === 2) {
      if (!isY) throw new ValidationError(`creature.crease(path[${i}]): 2-D [x, z] points need dir along ±Y; pass [x, y, z] points for other directions. ${DOC}`);
      const [x, z] = assertNumberTuple(arr, 2, `creature.crease(path[${i}])`);
      q = [x, mid[1], z];   // through the surface's middle, wherever it sits in Y
    } else {
      q = point3(arr, `creature.crease(path[${i}])`);
    }
    // `dir` is the OUTWARD direction: surfacePoint marches along it from far
    // behind and keeps the first inside→outside crossing — the outer face.
    // Reach from q far enough to span the whole bbox along the line.
    const reach = Math.hypot(q[0] - mid[0], q[1] - mid[1], q[2] - mid[2]) + halfDiag;
    const hit = surfacePoint(surface, q, dir, { reach });
    if (!hit) throw new ValidationError(`creature.crease(path[${i}]) = [${q.map((v) => +v.toFixed(2)).join(', ')}] misses the surface along dir [${dir.map((v) => +v.toFixed(2)).join(', ')}]. ${DOC}`);
    return [hit[0] - dir[0] * depth, hit[1] - dir[1] * depth, hit[2] - dir[2] * depth] as Vec3;
  });
  return surface.smoothSubtract(sdf.tube(seated, radius), soft);
}

// --- build ----------------------------------------------------------------

const BUILD_KEYS = ['skin', 'features', 'parts', 'ground', 'skinLabel', 'edgeLength', 'detail'] as const;
const MAX_DETAIL = 24;   // the core build's MAX_DETAIL_REGIONS

function buildCreature(sdf: CreatureSdfApi, raw: unknown): unknown {
  const o = opts(raw, 'creature.build(opts)', BUILD_KEYS);
  if (o.skin === undefined) throw new ValidationError(`creature.build: 'skin' (the welded body SDF) is required. ${DOC}`);
  let skin = assertNode(o.skin, 'creature.build.skin');
  const features = (o.features === undefined ? [] : assertArray(o.features, 'creature.build.features')).map((f, i) => {
    if (!isFeature(f)) throw new ValidationError(`creature.build.features[${i}] must come from creature.eyes/ears/feet/hands. ${DOC}`);
    return f;
  });
  const parts = (o.parts === undefined ? [] : assertArray(o.parts, 'creature.build.parts')).map((p, i) => assertNode(p, `creature.build.parts[${i}]`));
  // Default clip plane: the feet's ground; with no feet, don't clip (a creature
  // modelled around the origin would otherwise lose its lower half).
  const feetGround = features.find((f) => f.ground !== undefined)?.ground;
  const ground = o.ground === null || (o.ground === undefined && feetGround === undefined)
    ? null : num(o.ground, feetGround ?? 0, 'creature.build.ground');
  const skinLabel = str(o.skinLabel, 'skin', 'creature.build.skinLabel');
  const extraDetail = (o.detail === undefined ? [] : assertArray(o.detail, 'creature.build.detail')).map((d, i) => {
    const name = `creature.build.detail[${i}]`;
    const e = opts(d, name, ['center', 'radius', 'edgeLength']);
    return { center: point3(e.center, `${name}.center`), radius: num(e.radius, NaN, `${name}.radius`, 1e-6),
      edgeLength: num(e.edgeLength, NaN, `${name}.edgeLength`, 1e-3) } as DetailSphere;
  });
  for (const [i, d] of extraDetail.entries()) {
    if (Number.isNaN(d.radius) || Number.isNaN(d.edgeLength)) throw new ValidationError(`creature.build.detail[${i}] needs center, radius and edgeLength. ${DOC}`);
  }

  for (const f of features) skin = f.attach(skin);
  if (ground !== null) {
    // Flat soles: keep the skin (and unlabelled claws) at or above the ground
    // plane. Labelled parts are NOT clipped — an intersect would drop their label.
    const b = skin.bounds();
    const w = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1]) * 2 + 10;
    const h = Math.max(b.max[2] - ground, 1) + 10;
    skin = skin.intersect(sdf.box([w, w, h]).translate((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, ground + h / 2));
  }
  const detail = [...features.flatMap((f) => f.detail), ...extraDetail];
  if (detail.length > MAX_DETAIL) {
    throw new ValidationError(`creature.build: ${detail.length} detail spheres (features add ${detail.length - extraDetail.length}); the limit is ${MAX_DETAIL}. Pass fewer 'detail' entries. ${DOC}`);
  }
  const all = sdf.union(skin.label(skinLabel), ...features.flatMap((f) => f.parts), ...parts);
  const buildOpts: Record<string, unknown> = { detail };
  if (o.edgeLength !== undefined) buildOpts.edgeLength = num(o.edgeLength, 0.6, 'creature.build.edgeLength', 0.02);
  return all.build(buildOpts);
}

export function createCreatureNamespace(sdf: CreatureSdfApi): CreatureNamespace {
  return {
    eyes: (o) => buildEyes(sdf, o),
    ears: (o) => buildEars(sdf, o),
    feet: (o) => buildFeet(sdf, o),
    hands: (o) => buildHands(sdf, o),
    crease: (surface, path, o) => crease(sdf, surface, path, o),
    build: (o) => buildCreature(sdf, o),
  };
}
