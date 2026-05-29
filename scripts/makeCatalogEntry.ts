// Generate a catalog entry (.partwright.json + manifest.json row) from a
// manifold-js model file, reusing the REAL sandbox so the stored geometryData
// matches what the app would compute. Used to turn dogfooded parametric models
// into loadable catalog sessions.
//
// Usage:
//   npx tsx scripts/makeCatalogEntry.ts \
//     --model /tmp/dogfood/tray.js --id parametric-tray --name "Parametric Tray" \
//     --desc "Customizable rounded storage tray." [--params '{"width":80}'] [--label v1]
//
// Writes public/catalog/<id_with_underscores>.partwright.json and upserts the
// matching row in public/catalog/manifest.json (keyed by id).

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { manifoldJsEngine, getManifoldModule } from '../src/geometry/engines/manifoldJs';
import { pruneParamValues, type ParamSpec } from '../src/geometry/params';
import { SCHEMA_VERSION } from '../src/storage/sessionManager';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG_DIR = resolve(ROOT, 'public/catalog');

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function geometryDataFor(mesh: NonNullable<ReturnType<typeof manifoldJsEngine.run>['mesh']>): Record<string, unknown> {
  const mod = getManifoldModule();
  const manifold = mod.Manifold.ofMesh(mesh);
  try {
    const bb = manifold.boundingBox();
    const min = [bb.min[0], bb.min[1], bb.min[2]];
    const max = [bb.max[0], bb.max[1], bb.max[2]];
    const dimensions = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
    const parts = manifold.decompose();
    const componentCount = parts.length;
    for (const p of parts) { try { p.delete(); } catch { /* shared */ } }
    let genus: number | null = null;
    try { genus = manifold.genus(); } catch { /* non-manifold */ }
    return {
      status: 'ok',
      vertexCount: mesh.numVert,
      triangleCount: mesh.numTri,
      boundingBox: { x: [min[0], max[0]], y: [min[1], max[1]], z: [min[2], max[2]], dimensions },
      centroid: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
      volume: manifold.volume(),
      surfaceArea: manifold.surfaceArea(),
      genus,
      isManifold: true,
      componentCount,
      unit: 'mm',
    };
  } finally {
    try { manifold.delete(); } catch { /* freed */ }
  }
}

async function main(): Promise<void> {
  const model = arg('model');
  const id = arg('id');
  const name = arg('name');
  const desc = arg('desc') ?? '';
  const label = arg('label') ?? 'v1';
  const paramsRaw = arg('params');
  if (!model || !id || !name) {
    console.error('usage: --model <file> --id <id> --name <name> [--desc <text>] [--params <json>] [--label <label>]');
    process.exit(2);
  }
  const overrides: Record<string, unknown> = paramsRaw ? JSON.parse(paramsRaw) : {};
  const code = readFileSync(model, 'utf8');

  await manifoldJsEngine.init();
  const result = manifoldJsEngine.run(code, overrides);
  if (result.error || !result.mesh) {
    console.error(`model failed to run: ${result.error ?? 'no mesh'}`);
    process.exit(1);
  }

  const geometryData = geometryDataFor(result.mesh);
  // Don't immortalize a broken default: refuse empty/degenerate geometry.
  if (!((geometryData.volume as number) > 1e-9) || geometryData.componentCount === 0 || geometryData.triangleCount === 0) {
    console.error(`refusing to write a degenerate catalog entry (volume=${geometryData.volume}, components=${geometryData.componentCount}). Fix the model defaults first.`);
    process.exit(1);
  }
  const schema = (result.paramsSchema ?? []) as ParamSpec[];
  // Persist only the overrides that differ from declared defaults.
  const paramValues = pruneParamValues(schema, overrides);

  const now = Date.now();
  const session = {
    partwright: SCHEMA_VERSION,
    session: { name, created: now, updated: now, images: null, language: 'manifold-js' as const },
    parts: [{ name: 'Part 1', order: 0 }],
    versions: [{
      index: 1,
      code,
      label,
      geometryData,
      timestamp: now,
      language: 'manifold-js' as const,
      ...(Object.keys(paramValues).length > 0 ? { paramValues } : {}),
    }],
  };

  const file = `${id.replace(/-/g, '_')}.partwright.json`;
  writeFileSync(resolve(CATALOG_DIR, file), JSON.stringify(session, null, 2) + '\n');

  // Upsert the manifest row (keyed by id).
  const manifestPath = resolve(CATALOG_DIR, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { entries: Array<Record<string, unknown>> };
  const row = { id, name, file, language: 'manifold-js', description: desc };
  const idx = manifest.entries.findIndex(e => e.id === id);
  if (idx >= 0) manifest.entries[idx] = row; else manifest.entries.push(row);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  console.log(`wrote public/catalog/${file} and manifest row "${id}"`);
  console.log(`  params: ${schema.length} declared, ${Object.keys(paramValues).length} overridden`);
  console.log(`  geometry: vol=${(geometryData.volume as number).toFixed(1)} tris=${geometryData.triangleCount} components=${geometryData.componentCount} genus=${geometryData.genus}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
