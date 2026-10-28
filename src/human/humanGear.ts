// Accessories and held props for the parametric human.
//
// SOCKETS are frames on the posed skeleton — an origin plus x/y/z axes that
// turn with the bone they ride. Anything authored around a socket's origin in
// its local axes lands on the figure in any pose:
//
//   - every bone is a socket (origin at its head joint, axes = its rotation);
//   - named sockets add the useful spots: `head` (crown), `face` (between the
//     eyes), `neck`, `chest`, `back`, `waist`, `hip.L/R`, `shoulder.L/R`,
//     `forearm.L/R`, `foot.L/R`, and `hand.L/R` — a GRIP frame inside the
//     closed fist: +y runs through the fist from the little-finger side out
//     past the thumb (a sword's blade direction), +x along the fingers, +z out
//     of the palm.
//
// Local axes for every other socket match the world rest frame turned with
// the bone: +x the figure's left, +y its back, +z up (so "front" is −y, as
// everywhere else in Partwright).
//
// Props, hats, glasses, a necklace, a backpack and a cape are built from
// Manifold primitives sized from the figure itself (head radius, hand width,
// height), then placed through their socket.

import type { HumanAsset, HumanMesh, Vec3 } from './humanModel';

/** MakeHuman's eyeball radius in decimetres. */
const EYE_RADIUS_DM = 0.125;

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: Vec3): Vec3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** A frame on the posed figure: origin + orthonormal axes (world units). */
export interface Socket { origin: Vec3; x: Vec3; y: Vec3; z: Vec3 }

/** Column-major Mat4 placing socket-local coordinates in the world. */
export function socketMatrix(s: Socket): number[] {
  return [s.x[0], s.x[1], s.x[2], 0, s.y[0], s.y[1], s.y[2], 0, s.z[0], s.z[1], s.z[2], 0, s.origin[0], s.origin[1], s.origin[2], 1];
}

/** Socket from a row-major rotation (its columns are the axes) and an origin. */
function fromRotation(R: number[], origin: Vec3): Socket {
  return { origin, x: [R[0], R[3], R[6]], y: [R[1], R[4], R[7]], z: [R[2], R[5], R[8]] };
}

/** Measurements of the figure the accessories size themselves from (world units). */
export interface Measures {
  height: number;
  /** Head half-width / half-depth at the hat band, and the crown height above
   *  the head joint — all in the head socket's local frame. */
  headRx: number; headRy: number; headTop: number; bandZ: number; headFrontY: number;
  neckR: number;
  /** Half the width of the hand across the knuckles. */
  handHalf: number;
  /** Depth of the back surface behind the spine (chest socket local y). */
  backY: number;
  eyeR: number;
}

/** All sockets for a built human, keyed by name. */
export function computeSockets(asset: HumanAsset, mesh: HumanMesh, height: number): { sockets: Map<string, Socket>; measures: Measures } {
  const sockets = new Map<string, Socket>();
  const byName = new Map(asset.bones.map((b, i) => [b.name, i]));
  const J = (n: string): Vec3 => mesh.joints.get(`${n}____head`)!;
  const R = (n: string) => mesh.bones.R[byName.get(n)!];
  for (const b of asset.bones) sockets.set(b.name, fromRotation(R(b.name), J(b.name)));

  const k = mesh.scale;
  const restHead = mesh.restJoints.get('head____head')!;
  const eyeL = J('eye.L'), eyeR = J('eye.R');
  sockets.set('head', fromRotation(R('head'), J('head')));
  sockets.set('face', fromRotation(R('head'), scale(add(eyeL, eyeR), 0.5)));
  sockets.set('neck', fromRotation(R('neck02'), J('neck02')));
  sockets.set('chest', fromRotation(R('spine01'), J('spine01')));
  sockets.set('back', fromRotation(R('spine01'), J('spine01')));
  sockets.set('waist', fromRotation(R('spine03'), J('spine03')));
  for (const s of ['L', 'R'] as const) {
    sockets.set(`hip.${s}`, fromRotation(R(`pelvis.${s}`), J(`upperleg01.${s}`)));
    sockets.set(`shoulder.${s}`, fromRotation(R(`clavicle.${s}`), J(`upperarm01.${s}`)));
    sockets.set(`forearm.${s}`, fromRotation(R(`lowerarm01.${s}`), scale(add(J(`lowerarm01.${s}`), J(`wrist.${s}`)), 0.5)));
    sockets.set(`foot.${s}`, fromRotation(R(`foot.${s}`), J(`foot.${s}`)));
    // Grip: inside the curled fingers, axes from the hand's own landmarks.
    const wrist = J(`wrist.${s}`), index = J(`finger2-1.${s}`), pinky = J(`finger5-1.${s}`);
    const mid = scale(add(index, pinky), 0.5);
    const along = norm(sub(mid, wrist));
    let palm = norm(cross(sub(index, wrist), sub(pinky, wrist)));
    if (dot(palm, sub(J(`finger1-3.${s}`), mid)) < 0) palm = scale(palm, -1);
    const across = norm(sub(index, pinky));
    const y = norm(sub(across, scale(along, dot(across, along))));
    const z = cross(along, y);
    const handWidth = len(sub(index, pinky));
    const origin = add(add(mid, scale(along, handWidth * 0.35)), scale(palm, handWidth * 0.55));
    sockets.set(`hand.${s}`, { origin, x: along, y, z: dot(z, palm) >= 0 ? z : scale(z, -1) });
  }

  // Measurements come from BODY vertices only — the clothing helpers (hair
  // cap, tights, skirt) are weighted to the same bones but sit off the skin.
  const isBody = new Uint8Array(asset.nV);
  for (let t = 0; t < asset.nT; t++) if (asset.triLabel[t] === 0) for (let c = 0; c < 3; c++) isBody[asset.triVerts[t * 3 + c]] = 1;
  // Head measurements, from the rest-pose head vertices (rest frame = head
  // socket's local frame, up to the print scale).
  const headBones = new Set<number>();
  asset.bones.forEach((b, i) => { if (b.name === 'head' || (b.parent >= 0 && headBones.has(b.parent))) headBones.add(i); });
  let top = -Infinity, frontY = Infinity;
  const pts: Vec3[] = [];
  for (let v = 0; v < asset.nV; v++) {
    if (!isBody[v]) continue;
    let w = 0;
    for (let q = 0; q < 4; q++) if (headBones.has(asset.skinIndex[v * 4 + q])) w += asset.skinWeight[v * 4 + q];
    if (w < 0.6) continue;
    const p: Vec3 = sub([mesh.rest[v * 3], mesh.rest[v * 3 + 1], mesh.rest[v * 3 + 2]], restHead);
    pts.push(p);
    top = Math.max(top, p[2]);
  }
  const restEyeZ = mesh.restJoints.get('eye.L____head')![2] - restHead[2];
  const bandZ = restEyeZ + (top - restEyeZ) * 0.42;
  let rx = 0, ryMin = Infinity, ryMax = -Infinity;
  for (const p of pts) {
    if (Math.abs(p[2] - bandZ) > 0.12) continue;
    rx = Math.max(rx, Math.abs(p[0]));
    ryMin = Math.min(ryMin, p[1]); ryMax = Math.max(ryMax, p[1]);
    frontY = Math.min(frontY, p[1]);
  }
  // Neck radius: the mean distance of the neck-weighted skin round neck02
  // (the jaw and ears sit at the same height, so a plain radius window
  // would catch them).
  const neckZ = mesh.restJoints.get('neck02____head')![2];
  const neckC = mesh.restJoints.get('neck02____head')!;
  const neckBones = new Set(asset.bones.flatMap((b, i) => (b.name.startsWith('neck') ? [i] : [])));
  let neckSum = 0, neckN = 0;
  for (let v = 0; v < asset.nV; v++) {
    if (!isBody[v] || Math.abs(mesh.rest[v * 3 + 2] - neckZ) > 0.12) continue;
    let w = 0;
    for (let q = 0; q < 4; q++) if (neckBones.has(asset.skinIndex[v * 4 + q])) w += asset.skinWeight[v * 4 + q];
    if (w < 0.6) continue;
    neckSum += Math.hypot(mesh.rest[v * 3] - neckC[0], mesh.rest[v * 3 + 1] - neckC[1]);
    neckN++;
  }
  const neckR = neckN ? neckSum / neckN : 0.5;
  // Back surface depth behind the chest joint.
  const chestC = mesh.restJoints.get('spine01____head')!;
  let backY = 0;
  for (let v = 0; v < asset.nV; v++) {
    if (!isBody[v] || Math.abs(mesh.rest[v * 3 + 2] - chestC[2]) > 0.3 || Math.abs(mesh.rest[v * 3]) > 0.8) continue;
    backY = Math.max(backY, mesh.rest[v * 3 + 1] - chestC[1]);
  }
  const handHalf = len(sub(J('finger2-1.L'), J('finger5-1.L'))) / 2;
  const measures: Measures = {
    height,
    headRx: rx * k, headRy: ((ryMax - ryMin) / 2) * k, headTop: top * k, bandZ: bandZ * k, headFrontY: frontY * k,
    neckR: neckR * k, handHalf, backY: backY * k,
    eyeR: EYE_RADIUS_DM * k,
  };
  return { sockets, measures };
}

// --- Builders -------------------------------------------------------------------------

/** One accessory request (already validated). */
export interface GearOptions {
  item: string;
  label?: string;
  color?: string;
  /** Which hand / side, for props and shields. */
  hand?: 'L' | 'R';
  /** Overall size multiplier. */
  size?: number;
  style?: string;
  /** A user Manifold to attach, with its socket and local placement. */
  shape?: unknown;
  socket?: string;
  offset?: Vec3;
  rotate?: Vec3;
}

export const PROP_ITEMS = ['sword', 'dagger', 'axe', 'spear', 'staff', 'wand', 'torch', 'bow', 'shield'] as const;
export const HAT_ITEMS = ['tophat', 'cap', 'beanie', 'wizardhat', 'crown', 'tiara'] as const;
export const ACCESSORY_ITEMS = [...PROP_ITEMS, ...HAT_ITEMS, 'glasses', 'sunglasses', 'necklace', 'backpack', 'cape'] as const;

/** Default paint per accessory label. */
export const GEAR_COLORS: Record<string, string> = {
  sword: '#c9ced6', dagger: '#c9ced6', axe: '#b8bec6', spear: '#b8bec6', blade: '#c9ced6',
  hilt: '#6b4a2b', staff: '#7a5230', wand: '#3a2a20', torch: '#6b4a2b', flame: '#ff9a2e', orb: '#7fd6ff',
  bow: '#7a5230', string: '#e8e0c8', shield: '#7a2f2f', boss: '#c9b16a',
  tophat: '#1f1f22', cap: '#2f4f8f', beanie: '#8a2f3a', wizardhat: '#3b2f7a', crown: '#d4af37', tiara: '#d8d8e0',
  hatband: '#7a2f2f', glasses: '#2a2a2a', sunglasses: '#151515', lenses: '#1a2a3a', necklace: '#d4af37', pendant: '#3b8fd4',
  backpack: '#5a4a2a', cape: '#8a1f2a',
};

export interface GearPiece { label: string; color: string; manifold: unknown }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type M = any;

/**
 * Build every accessory as labelled world-space Manifolds. `worn` are the
 * worn shells' vertex positions (shifted by `wornZ` back into the body's
 * frame), so draped pieces sit over the clothes.
 */
export function buildGear(module: M, asset: HumanAsset, mesh: HumanMesh, items: GearOptions[], height: number, worn: Float32Array[] = [], wornZ = 0): GearPiece[] {
  const { Manifold, CrossSection } = module;
  const { sockets, measures: m } = computeSockets(asset, mesh, height);
  const h = m.height;
  const J = (n: string): Vec3 => mesh.joints.get(`${n}____head`)!;
  const out: GearPiece[] = [];
  const place = (shape: M, socketName: string) => {
    const s = sockets.get(socketName);
    if (!s) throw new Error(`unknown socket "${socketName}"`);
    return shape.transform(socketMatrix(s));
  };
  const piece = (label: string, color: string | undefined, shape: M) => out.push({ label, color: color ?? GEAR_COLORS[label] ?? '#888888', manifold: shape });
  /** Cylinder along +y from y0 to y1. */
  const rodY = (r: number, y0: number, y1: number, r1 = r) => Manifold.cylinder(y1 - y0, r, r1, 24).rotate([-90, 0, 0]).translate([0, y0, 0]);
  /** Ring (torus) of major radius R and tube radius r around +z. */
  const ring = (R: number, r: number) => Manifold.revolve(CrossSection.circle(r, 16).translate([R, 0]), 48);

  for (const o of items) {
    const s = o.size ?? 1;
    const side = o.hand ?? 'R';
    const grip = `hand.${side}`;
    const label = o.label ?? o.item;
    switch (o.item) {
      case 'custom': {
        let shape = o.shape as M;
        if (o.rotate) shape = shape.rotate(o.rotate);
        if (o.offset) shape = shape.translate(o.offset);
        piece(label, o.color, place(shape, o.socket ?? 'chest'));
        break;
      }
      case 'sword': case 'dagger': {
        const blade = (o.item === 'sword' ? 0.42 : 0.16) * h * s, g = m.handHalf * 1.3;
        const w = (o.item === 'sword' ? 0.026 : 0.022) * h * s, t = 0.007 * h * s;
        const bladeShape = Manifold.hull([
          Manifold.cube([w, 0.001, t], true).translate([0, g + 0.012 * h, 0]),
          Manifold.cube([w * 0.7, 0.001, t * 0.7], true).translate([0, g + blade * 0.85, 0]),
          Manifold.sphere(t * 0.3, 8).translate([0, g + blade, 0]),
        ]);
        const hilt = Manifold.union([
          rodY(0.011 * h * s, -g, g + 0.004 * h),
          Manifold.cube([w * 3.2 * (o.item === 'sword' ? 1 : 0.7), 0.012 * h * s, t * 1.8], true).translate([0, g + 0.006 * h, 0]),
          Manifold.sphere(0.017 * h * s, 16).translate([0, -g - 0.006 * h, 0]),
        ]);
        piece(label, o.color, place(bladeShape, grip));
        piece(`${label}Hilt`, GEAR_COLORS.hilt, place(hilt, grip));
        break;
      }
      case 'axe': {
        const g = m.handHalf * 1.3, L = 0.3 * h * s;
        const handle = rodY(0.012 * h * s, -g * 1.5, L);
        const head = Manifold.hull([
          Manifold.cube([0.03 * h * s, 0.05 * h * s, 0.012 * h * s], true).translate([0.02 * h * s, L - 0.03 * h * s, 0]),
          Manifold.cube([0.004 * h, 0.1 * h * s, 0.004 * h], true).translate([0.075 * h * s, L - 0.03 * h * s, 0]),
        ]);
        piece(`${label}Hilt`, GEAR_COLORS.hilt, place(handle, grip));
        piece(label, o.color, place(head, grip));
        break;
      }
      case 'spear': case 'staff': {
        const g = m.handHalf * 1.3, L = (o.item === 'spear' ? 0.75 : 0.8) * h * s;
        const shaft = rodY(0.011 * h * s, -L * 0.42, L * 0.58);
        piece(o.item === 'staff' ? label : `${label}Hilt`, o.item === 'staff' ? o.color : GEAR_COLORS.hilt, place(shaft, grip));
        if (o.item === 'spear') {
          const tip = Manifold.cylinder(0.08 * h * s, 0.02 * h * s, 0, 4).rotate([-90, 0, 0]).translate([0, L * 0.58 - 0.005 * h, 0]);
          piece(label, o.color, place(tip, grip));
        } else {
          piece('orb', GEAR_COLORS.orb, place(Manifold.sphere(0.035 * h * s, 24).translate([0, L * 0.58 + 0.025 * h * s, 0]), grip));
        }
        void g;
        break;
      }
      case 'wand': {
        const g = m.handHalf * 1.3;
        piece(label, o.color, place(rodY(0.007 * h * s, -g, 0.14 * h * s, 0.004 * h * s), grip));
        break;
      }
      case 'torch': {
        const g = m.handHalf * 1.3;
        piece(label, o.color, place(rodY(0.012 * h * s, -g * 1.4, 0.12 * h * s, 0.016 * h * s), grip));
        const flame = Manifold.hull([Manifold.sphere(0.022 * h * s, 16).translate([0, 0.13 * h * s, 0]), Manifold.sphere(0.004 * h, 8).translate([0, 0.19 * h * s, 0])]);
        piece('flame', GEAR_COLORS.flame, place(flame, grip));
        break;
      }
      case 'bow': {
        // Limbs: a shallow arc through the fist, bowing toward −z (away from the palm).
        const L = 0.36 * h * s, sag = 0.06 * h * s, r = 0.008 * h * s;
        const pts: Vec3[] = [];
        for (let i = 0; i <= 16; i++) { const t = i / 16 * 2 - 1; pts.push([0, t * L, -sag * (1 - t * t)]); }
        const limbs = Manifold.union(pts.slice(1).map((p, i) => Manifold.hull([Manifold.sphere(r, 10).translate(pts[i]), Manifold.sphere(r, 10).translate(p)])));
        const string = Manifold.hull([Manifold.sphere(r * 0.35, 6).translate(pts[0]), Manifold.sphere(r * 0.35, 6).translate(pts[16])]).translate([0, 0, -r * 0.5]);
        piece(label, o.color, place(limbs, grip));
        piece('string', GEAR_COLORS.string, place(Manifold.union([string, Manifold.hull([Manifold.sphere(r * 0.6, 6).translate(pts[0]), Manifold.sphere(r * 0.6, 6).translate(pts[0])])]), grip));
        break;
      }
      case 'shield': {
        // Strapped to the forearm, face out past the back of the hand (−z of the grip frame).
        const r = 0.12 * h * s, t = 0.012 * h * s;
        const kite = o.style === 'kite';
        const disc = kite
          ? Manifold.extrude(CrossSection.ofPolygons([[[0, r * 1.5], [r, r * 0.6], [r * 0.85, -r * 0.4], [0, -r * 1.5], [-r * 0.85, -r * 0.4], [-r, r * 0.6]]]), t)
          : Manifold.cylinder(t, r, r * 0.97, 48);
        const boss = Manifold.sphere(r * 0.22, 24).scale([1, 1, 0.5]).translate([0, 0, t]);
        const s0 = sockets.get(`forearm.${side}`)!;
        const hand = sockets.get(grip)!;
        // Face normal: away from the palm; centre: on the forearm, pushed out.
        const n = scale(hand.z, -1);
        const up = norm(sub(hand.y, scale(n, dot(hand.y, n))));
        const x = cross(up, n);
        const origin = add(s0.origin, scale(n, m.handHalf * 1.4));
        const frame: Socket = { origin, x, y: up, z: n };
        // Arm strap: a bar from the shield back into the forearm so it fuses.
        const strap = Manifold.cube([r * 0.25, r * 0.6, m.handHalf * 1.6], true).translate([0, 0, -m.handHalf * 0.75]);
        piece(label, o.color, Manifold.union([disc, strap]).transform(socketMatrix(frame)));
        piece('boss', GEAR_COLORS.boss, boss.transform(socketMatrix(frame)));
        break;
      }
      case 'tophat': case 'cap': case 'beanie': case 'wizardhat': case 'crown': case 'tiara': {
        const rx = m.headRx * 1.04 * s, ry = m.headRy * 1.04 * s, z0 = m.bandZ, top = m.headTop;
        const oval = (sh: M) => sh.scale([rx, ry, 1]);
        const yc = (m.headFrontY + m.headRy) * 0.5;   // head centre, front to back
        let shape: M, band: M | null = null;
        if (o.item === 'tophat') {
          const brim = oval(Manifold.cylinder(0.006 * h, 1.45, 1.45, 64)).translate([0, yc, z0]);
          const crown = oval(Manifold.cylinder(top - z0 + 0.09 * h, 1.0, 1.05, 64)).translate([0, yc, z0]);
          shape = Manifold.union([brim, crown]);
          band = oval(Manifold.cylinder(0.018 * h, 1.02, 1.02, 64)).translate([0, yc, z0 + 0.006 * h]);
        } else if (o.item === 'cap' || o.item === 'beanie') {
          const dome = Manifold.sphere(1, 48).scale([rx * 1.03, ry * 1.03, (top - z0) * 1.12]).translate([0, yc, z0]);
          const cut = Manifold.cube([rx * 4, ry * 4, h], true).translate([0, yc, z0 - h / 2]);
          shape = dome.subtract(cut);
          if (o.item === 'cap') {
            const visor = Manifold.cylinder(0.005 * h, 1, 1, 48).scale([rx * 0.95, ry * 0.8, 1]).translate([0, yc - ry * 0.75, z0]);
            shape = Manifold.union([shape, visor.subtract(Manifold.cube([rx * 4, ry * 2, h], true).translate([0, yc + ry * 0.4, z0]))]);
          } else {
            band = Manifold.sphere(1, 48).scale([rx * 1.08, ry * 1.08, (top - z0) * 0.5]).translate([0, yc, z0]).subtract(cut);
          }
        } else if (o.item === 'wizardhat') {
          const brim = oval(Manifold.cylinder(0.006 * h, 1.7, 1.7, 64)).translate([0, yc, z0]);
          const cone = Manifold.cylinder(0.32 * h * s, 1, 0.05, 64).scale([rx, ry, 1]).translate([0, yc, z0]);
          shape = Manifold.union([brim, cone.rotate([-12, 0, 0])]);
          band = oval(Manifold.cylinder(0.02 * h, 1.02, 1.0, 64)).translate([0, yc, z0 + 0.006 * h]);
        } else {
          // Crown / tiara: a band with points round the top edge.
          const bandH = (o.item === 'crown' ? 0.035 : 0.012) * h * s;
          const outer = oval(Manifold.cylinder(bandH, 1.0, 1.02, 64));
          const inner = Manifold.cylinder(bandH * 3, 1, 1, 64).scale([rx * 0.93, ry * 0.93, 1]).translate([0, 0, -bandH]);
          const parts: M[] = [outer.subtract(inner)];
          const nPts = o.item === 'crown' ? 8 : 5;
          for (let i = 0; i < nPts; i++) {
            const a = (o.item === 'crown' ? i / nPts : (i - 2) * 0.16) * Math.PI * 2 - Math.PI / 2;
            const ph = (o.item === 'crown' ? 0.03 : i === 2 ? 0.03 : 0.018) * h * s;
            parts.push(Manifold.cylinder(ph, 0.009 * h * s, 0, 4).translate([Math.cos(a) * rx * 1.0, Math.sin(a) * ry * 1.0, bandH * 0.9]));
          }
          shape = Manifold.union(parts).translate([0, yc, z0 + (o.item === 'tiara' ? 0.02 * h : 0)]);
        }
        piece(label, o.color, place(shape, 'head'));
        if (band) piece('hatband', GEAR_COLORS.hatband, place(band, 'head'));
        break;
      }
      case 'glasses': case 'sunglasses': {
        const head = sockets.get('head')!;
        const eyeL = sockets.get('eye.L')!.origin, eyeR = sockets.get('eye.R')!.origin;
        const fwd = scale(head.y, -1);
        const rimR = m.eyeR * 1.35 * s, tube = Math.max(0.004 * h, m.eyeR * 0.14);
        const parts: M[] = [];
        const lenses: M[] = [];
        const frame = (c: Vec3): Socket => ({ origin: add(c, scale(fwd, m.eyeR * 1.15)), x: head.x, y: head.z, z: fwd });
        for (const c of [eyeL, eyeR]) {
          parts.push(ring(rimR, tube).transform(socketMatrix(frame(c))));
          if (o.item === 'sunglasses') lenses.push(Manifold.cylinder(tube * 1.2, rimR, rimR, 32).translate([0, 0, -tube * 0.6]).transform(socketMatrix(frame(c))));
        }
        const bridgeA = add(add(eyeL, scale(fwd, m.eyeR * 1.15)), scale(head.x, -rimR));
        const bridgeB = add(add(eyeR, scale(fwd, m.eyeR * 1.15)), scale(head.x, rimR));
        parts.push(Manifold.hull([Manifold.sphere(tube, 8).translate(bridgeA), Manifold.sphere(tube, 8).translate(bridgeB)]));
        // Temples: from each rim's outer edge back along the head to the ear.
        for (const [c, sgn] of [[eyeL, 1], [eyeR, -1]] as [Vec3, number][]) {
          const a = add(add(c, scale(fwd, m.eyeR * 1.15)), scale(head.x, sgn * rimR));
          const b = add(add(a, scale(head.y, m.headRy * 1.1)), scale(head.x, sgn * (m.headRx - Math.abs(dot(sub(a, head.origin), head.x)))));
          parts.push(Manifold.hull([Manifold.sphere(tube, 8).translate(a), Manifold.sphere(tube, 8).translate(b)]));
        }
        piece(label, o.color, Manifold.union(parts));
        if (lenses.length) piece('lenses', GEAR_COLORS.lenses, Manifold.union(lenses));
        break;
      }
      case 'necklace': {
        // Drape a loop over the body round the base of the neck, lower at the
        // front: at each angle, find the skin's outermost point at the loop's
        // height and sit the chain just outside it.
        const c = J('neck01');
        const up = norm(sub(J('neck02'), c));
        const chest = sockets.get('chest')!;
        const fwd0 = scale(chest.y, -1);                     // the chest's rest −y
        const fwd = norm(sub(fwd0, scale(up, dot(fwd0, up))));
        const side = cross(up, fwd);
        const tube = 0.0035 * h * s;
        const drop = 0.028 * h * s;
        const N = 48;
        const skinPts: Vec3[] = [];
        // Neck and torso skin only: a raised arm passes close to the neck.
        const armBones = new Set(asset.bones.flatMap((b, i) => (/^(upperarm|lowerarm|wrist|finger|metacarpal|shoulder)/.test(b.name) ? [i] : [])));
        const armWeight = (v: number) => { let w = 0; for (let q = 0; q < 4; q++) if (armBones.has(asset.skinIndex[v * 4 + q])) w += asset.skinWeight[v * 4 + q]; return w; };
        const isSkin = new Uint8Array(asset.nV);
        for (let t = 0; t < asset.nT; t++) if (asset.triLabel[t] === 0) for (let q = 0; q < 3; q++) isSkin[asset.triVerts[t * 3 + q]] = 1;
        for (let v = 0; v < asset.nV; v++) {
          if (!isSkin[v] || armWeight(v) > 0.5) continue;
          const p: Vec3 = [mesh.posed[v * 3], mesh.posed[v * 3 + 1], mesh.posed[v * 3 + 2]];
          const q = sub(p, c);
          if (Math.abs(dot(q, up)) < drop + 0.03 * h && len(q) < 0.12 * h) skinPts.push(p);
        }
        let loop: Vec3[] = [];
        for (let i = 0; i < N; i++) {
          const th = (i / N) * Math.PI * 2;
          const dir = add(scale(fwd, Math.cos(th)), scale(side, Math.sin(th)));
          const hz = -0.008 * h - drop * ((1 + Math.cos(th)) / 2) ** 2;
          let r = 0;
          for (const p of skinPts) {
            const q = sub(p, c);
            const along = dot(q, dir);
            if (along <= 0 || Math.abs(dot(q, up) - hz) > 0.012 * h) continue;
            const across = len(sub(sub(q, scale(up, dot(q, up))), scale(dir, along)));
            if (across < along * 0.13) r = Math.max(r, along);
          }
          // Over the clothes: worn points on the same ray, near the skin.
          const rSkin = r || m.neckR * 1.3;
          for (const arr of worn) {
            for (let k = 0; k < arr.length; k += 3) {
              const q = sub([arr[k], arr[k + 1], arr[k + 2] - wornZ], c);
              const along = dot(q, dir);
              if (along <= 0 || along > rSkin + 0.02 * h || Math.abs(dot(q, up) - hz) > 0.012 * h) continue;
              const across = len(sub(sub(q, scale(up, dot(q, up))), scale(dir, along)));
              if (across < along * 0.13) r = Math.max(r, along);
            }
          }
          loop.push(add(add(c, scale(up, hz)), scale(dir, (r || rSkin) + tube * 0.6)));
        }
        for (let it = 0; it < 3; it++) loop = loop.map((p, i) => scale(add(add(p, p), add(loop[(i + N - 1) % N], loop[(i + 1) % N])), 0.25));
        const links = loop.map((p, i) => Manifold.hull([Manifold.sphere(tube, 8).translate(p), Manifold.sphere(tube, 8).translate(loop[(i + 1) % N])]));
        piece(label, o.color, Manifold.union(links));
        const front = loop[0];
        const pendant = Manifold.sphere(tube * 2.4, 16).scale([1, 0.6, 1.3]);
        const at = add(add(front, scale(up, -tube * 2.8)), scale(fwd, tube * 0.8));
        piece('pendant', GEAR_COLORS.pendant, pendant.translate(at));
        break;
      }
      case 'backpack': {
        const w = 0.17 * h * s, ht = 0.2 * h * s, d = 0.07 * h * s;
        const body = Manifold.hull([
          Manifold.cube([w, d, ht * 0.9], true),
          Manifold.cube([w * 0.9, d * 0.8, ht], true),
        ]).translate([0, m.backY + d * 0.45, -ht * 0.2]);
        const flap = Manifold.cube([w * 0.95, d * 0.25, ht * 0.35], true).translate([0, m.backY + d * 0.95, ht * 0.15]);
        piece(label, o.color, place(Manifold.union([body, flap]), 'chest'));
        break;
      }
      case 'cape': {
        // A slab hanging from the shoulders down the back, flaring and gently
        // rippled toward the hem; its top edge sinks into the shoulders so it fuses.
        const chest = sockets.get('chest')!;
        const shL = sockets.get('shoulder.L')!.origin, shR = sockets.get('shoulder.R')!.origin;
        const length = (o.size ?? 1) * 0.62 * h;
        const nu = 16, nv = 12, t = 0.012 * h;
        const back = chest.y;
        const pts: Vec3[] = [];
        for (let j = 0; j <= nv; j++) {
          const v = j / nv;
          for (let i = 0; i <= nu; i++) {
            const uu = i / nu;
            const topPt = add(add(shR, scale(sub(shL, shR), uu)), scale(back, m.backY * 0.35));
            const flare = 1 + 0.35 * v;
            const centre = scale(add(shL, shR), 0.5);
            const across = sub(topPt, centre);
            const ripple = Math.sin(uu * Math.PI * 6) * 0.012 * h * v;
            const p = add(add(add(centre, scale(across, flare)), scale(back, m.backY * (0.35 + 0.9 * v) + ripple)), [0, 0, -length * v]);
            pts.push(p);
          }
        }
        const idx = (i: number, j: number, side: number) => (j * (nu + 1) + i) * 2 + side;
        const verts: number[] = [];
        for (const p of pts) {
          verts.push(p[0] - back[0] * t / 2, p[1] - back[1] * t / 2, p[2] - back[2] * t / 2);
          verts.push(p[0] + back[0] * t / 2, p[1] + back[1] * t / 2, p[2] + back[2] * t / 2);
        }
        const tris: number[] = [];
        const quad = (a: number, b: number, c: number, d2: number) => tris.push(a, b, c, a, c, d2);
        for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
          quad(idx(i, j, 1), idx(i + 1, j, 1), idx(i + 1, j + 1, 1), idx(i, j + 1, 1));
          quad(idx(i, j, 0), idx(i, j + 1, 0), idx(i + 1, j + 1, 0), idx(i + 1, j, 0));
        }
        for (let i = 0; i < nu; i++) {
          quad(idx(i, 0, 0), idx(i + 1, 0, 0), idx(i + 1, 0, 1), idx(i, 0, 1));
          quad(idx(i, nv, 0), idx(i, nv, 1), idx(i + 1, nv, 1), idx(i + 1, nv, 0));
        }
        for (let j = 0; j < nv; j++) {
          quad(idx(0, j, 0), idx(0, j, 1), idx(0, j + 1, 1), idx(0, j + 1, 0));
          quad(idx(nu, j, 0), idx(nu, j + 1, 0), idx(nu, j + 1, 1), idx(nu, j, 1));
        }
        let shape = Manifold.ofMesh(new module.Mesh({ numProp: 3, vertProperties: new Float32Array(verts), triVerts: new Uint32Array(tris) }));
        if (shape.volume() < 0) shape = Manifold.ofMesh(new module.Mesh({ numProp: 3, vertProperties: new Float32Array(verts), triVerts: new Uint32Array(tris.map((_, q) => tris[q - (q % 3) + [0, 2, 1][q % 3]])) }));
        // A clasp bar across the collarbones ties the cape into the body.
        const clasp = Manifold.hull([Manifold.sphere(0.012 * h, 12).translate(shL), Manifold.sphere(0.012 * h, 12).translate(shR)]);
        piece(label, o.color, Manifold.union([shape, clasp]));
        break;
      }
      default:
        throw new Error(`unknown accessory "${o.item}"`);
    }
  }
  return out;
}
