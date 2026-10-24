// Unit tests for src/geometry/sdfCreature.ts — the api.sdf.creature feature
// kit. Pure field evaluation (no WASM): eyes cut an aperture and clip the
// eyeball, creases seat on the real outer face, features mirror with their
// detail spheres, and build() attaches/clips/collects before meshing. Meshing
// itself is exercised headlessly via model:preview on examples/creature_ned.js.

import { describe, it, expect } from 'vitest';
import { createCreatureNamespace, type CreatureSdfApi } from '../../src/geometry/sdfCreature';
import { __testables__ as sdfT, type SdfNode } from '../../src/geometry/sdf';

const api = {
  sphere: sdfT.primSphere,
  ellipsoid: sdfT.primEllipsoid,
  box: sdfT.primBox,
  capsule: sdfT.primCapsule,
  tube: sdfT.primTube,
  union: (...nodes: SdfNode[]) => nodes.reduce((a, b) => sdfT.opUnion(a, b)),
} as unknown as CreatureSdfApi;
const C = createCreatureNamespace(api);
const ev = (n: unknown, p: number[]): number => (n as SdfNode).evaluate(p[0], p[1], p[2]);
const labelOf = (n: unknown): string | undefined => (n as { labelName?: string }).labelName;

describe('creature.eyes', () => {
  const at = [8, -10, 40];
  const eyes = C.eyes({ at, radius: 6 });

  it('labels the eyeballs and mirrors them across X', () => {
    expect(eyes.parts).toHaveLength(1);
    expect(labelOf(eyes.parts[0])).toBe('eyes');
    const front = [at[0], at[1] - 5, at[2]];
    expect(ev(eyes.parts[0], front)).toBeLessThan(0);
    expect(ev(eyes.parts[0], [-front[0], front[1], front[2]])).toBeLessThan(0);
  });

  it('clips the back of the eyeball so it cannot poke out of the skull', () => {
    // Inside the raw ellipsoid, but behind the opening: removed by the clip.
    expect(ev(eyes.parts[0], [at[0], at[1] + 4, at[2]])).toBeGreaterThan(0);
  });

  it('attach cuts an aperture through an enclosing skin', () => {
    const skin = api.sphere(30).translate(0, 4, 40) as unknown as SdfNode;
    const front = [at[0], at[1] - 7.5, at[2]];   // just in front of the eyeball, inside the old skin
    expect(ev(skin, front)).toBeLessThan(0);
    const carved = eyes.attach(skin as never);
    expect(ev(carved, front)).toBeGreaterThan(0);
    expect(ev(carved, [-front[0], front[1], front[2]])).toBeGreaterThan(0);
  });

  it('brings a detail sphere per eye', () => {
    expect(eyes.detail).toHaveLength(2);
    expect(eyes.detail[1].center[0]).toBeCloseTo(-eyes.detail[0].center[0], 9);
    expect(C.eyes({ at, mirror: false }).detail).toHaveLength(1);
  });

  it('validates its options', () => {
    expect(() => C.eyes({})).toThrow(/'at'/);
    expect(() => C.eyes({ at, colour: 'red' })).toThrow(/colour/);
    expect(() => C.eyes({ at, opening: 2 })).toThrow(/opening/);
    expect(() => C.eyes({ at, aspect: [1, 0, 1] })).toThrow(/aspect/);
    expect(C.eyes({ at, radius: null }).detail).toHaveLength(2);   // null = default
  });
});

describe('creature.crease', () => {
  const head = api.sphere(10) as unknown as SdfNode;

  it('carves a groove on the outer face along dir, leaving the back untouched', () => {
    const carved = C.crease(head as never, [[-4, 0], [4, 0]], { radius: 0.8, depth: 0.5 });
    // Front surface point at x = 0: y ≈ −10 → now carved away.
    expect(ev(carved, [0, -9.8, 0])).toBeGreaterThan(0);
    // Back of the sphere is unchanged.
    expect(ev(carved, [0, 9.8, 0])).toBeCloseTo(ev(head, [0, 9.8, 0]), 9);
  });

  it('accepts 3-D points with any outward dir', () => {
    const carved = C.crease(head as never, [[0, -3, -2], [0, 3, 2]], { dir: [1, 0, 0], radius: 0.6 });
    // The groove runs along the chord between the two seated points (x ≈ 8.9).
    expect(ev(carved, [9.4, 0, 0])).toBeGreaterThan(0);
    expect(ev(carved, [-9.4, 0, 0])).toBeLessThan(0);
  });

  it('seats 2-D points on a surface that sits far from y = 0', () => {
    const snout = api.sphere(10).translate(0, -40, 50) as unknown as SdfNode;
    const carved = C.crease(snout as never, [[-3, 50], [3, 50]], { radius: 0.6 });
    expect(ev(carved, [0, -49.6, 50])).toBeGreaterThan(0);
  });

  it('rejects points that miss the surface and 2-D points off the Y axis', () => {
    expect(() => C.crease(head as never, [[0, 0], [40, 0]])).toThrow(/misses the surface/);
    expect(() => C.crease(head as never, [[0, 0], [1, 0]], { dir: [1, 0, 0] })).toThrow(/dir along ±Y/);
    expect(() => C.crease({} as never, [[0, 0], [1, 0]])).toThrow(/SDF node/);
  });
});

describe('creature.ears / feet / hands', () => {
  it('ears add a labelled inner membrane unless inner: false', () => {
    const ears = C.ears({ root: [14, 0, 60], length: 30 });
    expect(ears.parts.map(labelOf)).toEqual(['innerEar']);
    expect(ears.detail).toHaveLength(2);
    expect(C.ears({ root: [14, 0, 60], inner: false }).parts).toHaveLength(0);
    expect(C.ears({ root: [14, 0, 60], innerLabel: 'membrane' }).parts.map(labelOf)).toEqual(['membrane']);
  });

  it('ears grow the skin out to the side, on both sides', () => {
    const skin = api.sphere(15).translate(0, 0, 60) as unknown as SdfNode;
    const ears = C.ears({ root: [12, 0, 60], length: 30, lift: 0, sweep: 0 });
    const s = ears.attach(skin as never);
    // Mid-ear, on the cup's shell (the cup's back sits near y = 0).
    expect(ev(s, [12 + 15, 0, 60])).toBeLessThan(0.5);
    expect(ev(s, [-(12 + 15), 0, 60])).toBeLessThan(0.5);
    expect(ev(skin, [27, 0, 60])).toBeGreaterThan(5);
  });

  it('feet merge claws into the skin unless a clawLabel is given', () => {
    expect(C.feet({ at: [12, 0] }).parts).toHaveLength(0);
    const labelled = C.feet({ at: [12, 0], clawLabel: 'claws' });
    expect(labelled.parts.map(labelOf)).toEqual(['claws']);
    expect(() => C.feet({ at: [12, 0, 0] })).toThrow(/feet\.at/);
    expect(() => C.feet({ at: [12, 0], toes: 2.5 })).toThrow(/toes/);
  });

  it('hands hang below the palm centre', () => {
    const hands = C.hands({ at: [30, -5, 30] });
    const s = hands.attach(api.sphere(1).translate(0, 0, 100) as never);
    expect(ev(s, [30, -5, 30])).toBeLessThan(0);
    expect(ev(s, [-30, -5, 30])).toBeLessThan(0);
    expect(hands.detail).toHaveLength(2);
  });
});

describe('creature.build', () => {
  // A union that records what build() hands to the mesher instead of meshing.
  let captured: { nodes: SdfNode[]; opts: Record<string, unknown> } | null = null;
  const recApi = {
    ...api,
    union: (...nodes: SdfNode[]) => ({
      build: (opts: Record<string, unknown>) => { captured = { nodes, opts }; return 'MESH'; },
    }),
  } as unknown as CreatureSdfApi;
  const R = createCreatureNamespace(recApi);
  const skin = api.sphere(20).translate(0, 0, 18) as unknown as SdfNode;

  it('labels the skin, flattens it at the ground, and gathers parts + detail', () => {
    const eyes = R.eyes({ at: [6, -14, 24], radius: 4 });
    const nose = api.sphere(2).translate(0, -20, 18).label('nose');
    const out = R.build({ skin, features: [eyes], parts: [nose], edgeLength: 0.7, ground: 0,
      detail: [{ center: [0, -15, 20], radius: 8, edgeLength: 0.2 }] });
    expect(out).toBe('MESH');
    const { nodes, opts } = captured!;
    expect(nodes.map(labelOf)).toEqual(['skin', 'eyes', 'nose']);
    expect(opts.edgeLength).toBe(0.7);
    expect((opts.detail as unknown[]).length).toBe(3);
    // The skin sphere dipped to z = −2; build clipped it flat at z = 0.
    expect(ev(nodes[0], [0, 0, -1])).toBeGreaterThan(0);
    expect(ev(nodes[0], [0, 0, 1])).toBeLessThan(0);
  });

  it('clips at the feet\'s ground by default, and not at all without feet', () => {
    R.build({ skin, features: [C.feet({ at: [12, 0], ground: 3 })] });
    expect(ev(captured!.nodes[0], [0, 0, 2])).toBeGreaterThan(0);
    expect(ev(captured!.nodes[0], [0, 0, 4])).toBeLessThan(0);
    R.build({ skin });
    expect(ev(captured!.nodes[0], [0, 0, -1])).toBeLessThan(0);
  });

  it('validates user detail spheres by their own index', () => {
    expect(() => R.build({ skin, detail: [{ center: [0, 0], radius: 1, edgeLength: 0.2 }] })).toThrow(/build\.detail\[0\]\.center/);
    expect(() => R.build({ skin, detail: [{ center: [0, 0, 0] }] })).toThrow(/detail\[0\]/);
  });

  it('ground: null keeps the full skin; skinLabel renames it', () => {
    R.build({ skin, ground: null, skinLabel: 'fur' });
    expect(labelOf(captured!.nodes[0])).toBe('fur');
    expect(ev(captured!.nodes[0], [0, 0, -1])).toBeLessThan(0);
  });

  it('rejects a missing skin, foreign features and too many detail spheres', () => {
    expect(() => R.build({})).toThrow(/'skin'/);
    expect(() => R.build({ skin, features: [skin] })).toThrow(/features\[0\]/);
    const many = Array.from({ length: 23 }, () => ({ center: [0, 0, 0], radius: 1, edgeLength: 0.2 }));
    expect(() => R.build({ skin, features: [R.eyes({ at: [6, -14, 24] })], detail: many })).toThrow(/limit is 24/);
  });
});
