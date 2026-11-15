// sealBulkRecords (src/geometry/modelEval.ts): imported meshes are locked down
// for model code without the harden pass ever walking their typed arrays.
//
// The module's compiler/hardener is installed once per process, so the tests
// run in order: legacy path first, then with a hardener installed.

import { describe, it, expect } from 'vitest';
import { hardenModelShared, installModelCompiler, sealBulkRecords } from '../../src/geometry/modelEval';

/** A stand-in for SES `harden` that walks the way it does: own property
 *  descriptors — data values are followed, accessors are frozen but never
 *  called — and counts every own key it lists (the cost that matters). */
function makeWalkingHardener() {
  const seen = new WeakSet<object>();
  const stats = { keysListed: 0, typedArraysVisited: 0 };
  const harden = <T>(root: T): T => {
    const stack: unknown[] = [root];
    while (stack.length > 0) {
      const o = stack.pop();
      if (o === null || (typeof o !== 'object' && typeof o !== 'function')) continue;
      if (seen.has(o as object)) continue;
      seen.add(o as object);
      if (ArrayBuffer.isView(o)) stats.typedArraysVisited++;
      const descs = Object.getOwnPropertyDescriptors(o);
      for (const key of Reflect.ownKeys(descs)) {
        stats.keysListed++;
        const d = descs[key as string];
        if ('value' in d) stack.push(d.value);
        else { stack.push(d.get); stack.push(d.set); }
      }
      if (!ArrayBuffer.isView(o)) Object.freeze(o);
      else Object.preventExtensions(o);
    }
    return root;
  };
  return { harden, stats };
}

const record = (n: number) => ({ numProp: 3, vertProperties: new Float32Array(n * 3), triVerts: new Uint32Array(n * 3) });

describe('sealBulkRecords', () => {
  it('leaves the list alone on the legacy (no SES) path', () => {
    const list = [record(4)];
    expect(sealBulkRecords(list)).toBe(list);
    expect(Object.isFrozen(list)).toBe(false);
    expect(Object.isFrozen(list[0])).toBe(false);
    expect(Object.isExtensible(list[0].vertProperties)).toBe(true);
  });

  it('with a hardener: freezes the list and records, leaves the arrays unwalked but non-extensible', () => {
    const { harden, stats } = makeWalkingHardener();
    installModelCompiler(() => () => undefined, harden);

    const extra = { nested: { deep: 1 } };
    const list = [{ ...record(1000), extra }, record(1000)];
    const sealed = sealBulkRecords(list);

    expect(sealed).toBe(list);
    expect(Object.isFrozen(list)).toBe(true);
    for (const r of list) {
      expect(Object.isFrozen(r)).toBe(true);
      expect(Object.isExtensible(r.vertProperties)).toBe(false);
      expect(Object.isExtensible(r.triVerts)).toBe(false);
    }
    // Elements stay writable (they can't be frozen) — the arrays are the run's own copies.
    list[0].vertProperties[0] = 7;
    expect(list[0].vertProperties[0]).toBe(7);
    // Other object values are hardened as usual.
    expect(Object.isFrozen(extra)).toBe(true);
    expect(Object.isFrozen(extra.nested)).toBe(true);
    // The typed arrays were never handed to the hardener.
    expect(stats.typedArraysVisited).toBe(0);
    expect(stats.keysListed).toBeLessThan(20);
  });

  it('an accessor on api keeps the harden walk off the arrays; a data property would not', () => {
    // (The hardener installed by the previous test is still the active one.)
    const triangles = 50_000;
    const viaAccessor = sealBulkRecords([record(triangles)]);
    const { harden: walkA, stats: a } = makeWalkingHardener();
    const apiA = { get imports() { return viaAccessor; }, other: { x: 1 } };
    walkA(apiA);
    expect(a.typedArraysVisited).toBe(0);
    expect(a.keysListed).toBeLessThan(20);
    expect(Object.isFrozen(apiA)).toBe(true);
    expect(apiA.imports).toBe(viaAccessor);

    // What the engines did before: a data property — every element is listed.
    const { harden: walkB, stats: b } = makeWalkingHardener();
    walkB({ imports: [record(triangles)] });
    expect(b.typedArraysVisited).toBe(2);
    expect(b.keysListed).toBeGreaterThan(triangles * 6);
  });

  it('hardenModelShared uses the installed hardener', () => {
    const o = { a: { b: 1 } };
    hardenModelShared(o);
    expect(Object.isFrozen(o.a)).toBe(true);
  });
});
