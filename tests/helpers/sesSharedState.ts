// Model-code probes for the SES shared-state check (#1127): run MARK in one
// run and CHECK in a later run in the same engine Worker. MARK walks every
// object reachable from `api` and from instances the common API calls hand
// back (data properties + [[Prototype]], no getters), and stamps each one it
// can still extend with a registry-symbol property. CHECK walks the same way
// and reports every object that carries the stamp — i.e. an object that
// outlived the run AND that model code could write to. With SES on, the list
// must be empty.
//
// The walk body is shared; `seeds` is model-code source that evaluates to an
// array of [label, value] pairs to start from (per engine).

const WALK = String.raw`
  const MARK = Symbol.for('pw-ses-shared-state-probe');
  const walk = (seeds, visit, limit) => {
    const seen = new Set(); const q = []; let n = 0; let head = 0;
    for (const [label, v] of seeds) q.push([v, label]);
    while (head < q.length && n < limit) {
      const [o, path] = q[head++];
      if (o === null || (typeof o !== 'object' && typeof o !== 'function') || seen.has(o)) continue;
      seen.add(o); n++;
      visit(o, path);
      let keys = [];
      // Typed arrays (a WASM heap view could be millions long): no index keys.
      try { keys = ArrayBuffer.isView(o) ? [] : Reflect.ownKeys(o); } catch (e) { continue; }
      for (const k of keys) {
        let d; try { d = Object.getOwnPropertyDescriptor(o, k); } catch (e) { continue; }
        if (d && 'value' in d) q.push([d.value, path + '.' + String(k)]);
      }
      let p; try { p = Object.getPrototypeOf(o); } catch (e) { p = null; }
      if (p) q.push([p, path + '.__proto__']);
    }
    return n;
  };
`;

export function markCode(seeds: string, tail: string): string {
  return `${WALK}
  const marked = [];
  const visited = walk(${seeds}, (o, path) => {
    try { Object.defineProperty(o, MARK, { value: 1, configurable: true }); marked.push(path); } catch (e) { /* frozen / non-extensible: fine */ }
  }, 50000);
  ${tail}`;
}

export function checkCode(seeds: string): string {
  return `${WALK}
  const found = [];
  const visited = walk(${seeds}, (o, path) => {
    try { if (Object.getOwnPropertyDescriptor(o, MARK)) found.push(path); } catch (e) { /* proxy */ }
  }, 50000);
  throw new Error('SHARED:' + JSON.stringify({ visited, found: found.slice(0, 200), count: found.length }));`;
}

/** Seeds for a manifold-js run: the api plus instances it hands back. */
export const MANIFOLD_SEEDS = String.raw`(() => {
  const { Manifold, CrossSection } = api;
  const cube = Manifold.cube([1, 1, 1]);
  const cs = CrossSection.circle(2, 16);
  const node = api.sdf.sphere(1);
  const seeds = [['api', api], ['manifold', cube], ['crossSection', cs], ['mesh', cube.getMesh()], ['sdfNode', node], ['ext', cs.extrude(1)]];
  try { seeds.push(['text', api.text('A', { size: 3, height: 1 })]); } catch (e) { /* fonts not loaded */ }
  if (api.BREP) seeds.push(['brep', api.BREP.box([2, 2, 2])]);
  // Values from a spread of namespaces, and the errors api calls throw (an
  // error's class prototype is shared too).
  const tryPush = (label, f) => { try { seeds.push([label, f()]); } catch (e) { seeds.push([label + '!', e]); } };
  tryPush('bbox', () => api.bbox(cube));
  tryPush('componentBounds', () => api.componentBounds(cube));
  tryPush('decompose', () => cube.decompose());
  tryPush('boundingBox', () => cube.boundingBox());
  tryPush('sdfBuild', () => api.sdf.sphere(1).build({ edgeLength: 0.5 }));
  tryPush('geom', () => api.geom.roundedRect([4, 2], 0.5));
  tryPush('loft', () => api.loft([CrossSection.square([1, 1]), CrossSection.square([2, 2])], [0, 1]));
  tryPush('gear', () => api.gears.spur({ teeth: 8, module: 1, thickness: 1 }));
  tryPush('paramsValue', () => api.params({ w: { type: 'number', default: 1 } }));
  tryPush('errValidation', () => Manifold.sphere());
  tryPush('errEmbind', () => Manifold.cube('bad'));
  // The glue's own error classes: an embind BindingError (bad argument type),
  // manifold-3d's ManifoldError (invalid mesh), a use-after-delete.
  tryPush('errBinding', () => cube.add(5));
  tryPush('errManifold', () => new Manifold({}));
  tryPush('errDeleted', () => { const t = Manifold.cube([1, 1, 1]); t.delete(); return t.volume(); });
  tryPush('errCrossSection', () => cs.add(5));
  tryPush('errLabel', () => api.label(1, 'x'));
  tryPush('errPaint', () => api.paint.box({}));
  if (api.BREP) tryPush('errBrep', () => api.BREP.box('bad'));
  return seeds;
})()`;

/** Seeds for a voxel run. */
export const VOXEL_SEEDS = String.raw`(() => {
  const v = api.voxels(); v.set(0, 0, 0, '#ff0000');
  const seeds = [['api', api], ['grid', v], ['sdfNode', api.sdf.sphere(1)]];
  try { v.set('bad'); } catch (e) { seeds.push(['err', e]); }
  try { api.paint.box({}); } catch (e) { seeds.push(['errPaint', e]); }
  return seeds;
})()`;

/** Seeds for a replicad run. */
export const REPLICAD_SEEDS = String.raw`(() => {
  const b = api.BREP.box([2, 2, 2]);
  const seeds = [['api', api], ['brep', b], ['brepFillet', b.fillet(0.2)], ['brepMesh', b.toMesh()], ['brepEdges', b.edges ? b.edges() : null]];
  try { seeds.push(['step', b.blobSTEP()]); } catch (e) { seeds.push(['stepErr', e]); }
  try { api.BREP.box('bad'); } catch (e) { seeds.push(['err', e]); }
  return seeds;
})()`;
