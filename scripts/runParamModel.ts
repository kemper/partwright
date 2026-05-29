// Headless parametric-model runner.
//
// Reuses the REAL manifold-js sandbox (src/geometry/engines/manifoldJs.ts), so
// it exercises `api.params({...})`, the Curves/meshOps helpers, and the boolean
// kernel exactly as the browser does — just with no DOM and no browser. It's
// the fast inner loop for authoring and dogfooding Customizer models.
//
// Usage:
//   npx tsx scripts/runParamModel.ts <model.js> [--params '{"width":50,"rows":3}']
//   npx tsx scripts/runParamModel.ts <model.js> --json     # machine-readable
//
// Prints the captured parameter schema and geometry stats (volume, surface
// area, triangle count, component count, genus, bounding box) for the run.

import { readFileSync } from 'node:fs';
import { manifoldJsEngine, getManifoldModule } from '../src/geometry/engines/manifoldJs';

interface Stats {
  ok: boolean;
  error?: string;
  /** Set when the run produced geometry but it's empty/degenerate (zero volume,
   *  no triangles, or a non-finite bbox) — a legal-looking run that silently
   *  yields nothing, e.g. a corner radius that collapses the whole profile. */
  degenerate?: string;
  paramsSchema?: unknown;
  resolvedFromSchema?: Record<string, unknown>;
  volume?: number;
  surfaceArea?: number;
  triangleCount?: number;
  vertexCount?: number;
  componentCount?: number;
  genus?: number;
  boundingBox?: { min: number[]; max: number[]; size: number[] };
  /** api.label(shape, name) regions that survived to the result mesh, with their
   *  triangle counts — lets a catalog author confirm paint-plan labels resolve. */
  labels?: { name: string; triangles: number }[];
}

function parseArgs(argv: string[]): { file?: string; params: Record<string, unknown>; json: boolean } {
  const params: Record<string, unknown> = {};
  let file: string | undefined;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--params') {
      const raw = argv[++i];
      if (raw) Object.assign(params, JSON.parse(raw));
    } else if (a === '--json') {
      json = true;
    } else if (!a.startsWith('--') && !file) {
      file = a;
    }
  }
  return { file, params, json };
}

function computeStats(result: ReturnType<typeof manifoldJsEngine.run>): Stats {
  if (result.error || !result.mesh) {
    return { ok: false, error: result.error ?? 'no mesh returned', paramsSchema: result.paramsSchema };
  }
  const mod = getManifoldModule();
  // The worker frees the live result manifold after extracting the mesh; here
  // we just rebuild one from the mesh data for queries, then delete it.
  const manifold = mod.Manifold.ofMesh(result.mesh);
  try {
    const bbox = manifold.boundingBox();
    const min = [bbox.min[0], bbox.min[1], bbox.min[2]];
    const max = [bbox.max[0], bbox.max[1], bbox.max[2]];
    const components = manifold.decompose();
    const componentCount = components.length;
    for (const c of components) { try { c.delete(); } catch { /* shared */ } }
    const volume = manifold.volume();
    const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
    // A run can "succeed" yet yield nothing — e.g. a corner radius that collapses
    // the whole profile, or a bore that eats the body. Flag it loudly: a legal
    // slider position that silently produces empty geometry is exactly the trap
    // that ships a broken catalog entry.
    let degenerate: string | undefined;
    if (componentCount === 0 || result.mesh.numTri === 0) degenerate = 'empty result (no geometry)';
    else if (!(volume > 1e-9)) degenerate = `near-zero volume (${volume})`;
    else if (!size.every(Number.isFinite)) degenerate = 'non-finite bounding box';
    return {
      ok: !degenerate,
      degenerate,
      paramsSchema: result.paramsSchema,
      volume,
      surfaceArea: manifold.surfaceArea(),
      triangleCount: result.mesh.numTri,
      vertexCount: result.mesh.numVert,
      componentCount,
      genus: manifold.genus(),
      boundingBox: { min, max, size },
      labels: result.labelMap ? Array.from(result.labelMap, ([name, tris]) => ({ name, triangles: tris.size })) : [],
    };
  } finally {
    try { manifold.delete(); } catch { /* already freed */ }
  }
}

async function main(): Promise<void> {
  const { file, params, json } = parseArgs(process.argv.slice(2));
  if (!file) {
    console.error('usage: npx tsx scripts/runParamModel.ts <model.js> [--params \'{"k":v}\'] [--json]');
    process.exit(2);
  }
  const code = readFileSync(file, 'utf8');
  await manifoldJsEngine.init();
  const result = manifoldJsEngine.run(code, params);
  const stats = computeStats(result);

  if (json) {
    console.log(JSON.stringify(stats, null, 2));
  } else {
    console.log(`\n=== ${file} ===`);
    if (Object.keys(params).length) console.log('overrides:', JSON.stringify(params));
    if (stats.degenerate) {
      console.log(`STATUS: DEGENERATE — ${stats.degenerate}`);
      console.log('The model ran but produced empty/invalid geometry. Check parameter');
      console.log('combinations (e.g. a radius/bore/wall that erases the solid).');
    } else if (!stats.ok) {
      console.log('STATUS: ERROR');
      console.log(stats.error);
    } else {
      console.log('STATUS: OK');
      const schema = stats.paramsSchema as Array<Record<string, unknown>> | undefined;
      if (schema?.length) {
        console.log(`\nparameters (${schema.length}):`);
        for (const s of schema) {
          const range = s.min !== undefined || s.max !== undefined ? ` [${s.min ?? ''}…${s.max ?? ''}]` : '';
          const opts = s.options ? ` {${(s.options as Array<{ value: string }>).map(o => o.value).join('|')}}` : '';
          console.log(`  - ${s.key}: ${s.type}${range}${opts} default=${JSON.stringify(s.default)}`);
        }
      } else {
        console.log('\nparameters: (none declared)');
      }
      console.log('\ngeometry:');
      console.log(`  volume        ${stats.volume?.toFixed(3)}`);
      console.log(`  surfaceArea   ${stats.surfaceArea?.toFixed(3)}`);
      console.log(`  triangles     ${stats.triangleCount}`);
      console.log(`  vertices      ${stats.vertexCount}`);
      console.log(`  components    ${stats.componentCount}`);
      console.log(`  genus         ${stats.genus}`);
      console.log(`  bbox size     [${stats.boundingBox?.size.map(n => n.toFixed(2)).join(', ')}]`);
      if (stats.labels && stats.labels.length > 0) {
        console.log(`\nlabels (${stats.labels.length}, for paintByLabel):`);
        for (const l of stats.labels) console.log(`  - ${l.name}: ${l.triangles} triangles`);
      }
    }
    console.log('');
  }
  process.exit(stats.ok ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
