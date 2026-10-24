#!/usr/bin/env node
// Bake the Character Creator preset thumbnails.
//
//   npm run bake:character-presets -- [--only id1,id2] [--size 360]
//   npm run bake:character-presets -- --random 20 [--seed-start 1000]
//
// For every entry in CHARACTER_PRESETS (src/figure/characterSpec.ts) this
// generates the figure code (characterCodegen.ts), builds it with the real
// manifold-js engine under Node SSR (the same path as `model:preview`), renders
// a single front-¾ view and writes public/character-presets/<id>.webp — the
// image the panel's preset cards show. Fails non-zero if any preset doesn't
// build as one manifold piece with every face feature visible, so a broken
// preset never ships a thumbnail.
//
// --random N checks the 🎲 Random generator instead: it builds N seeded rolls
// (src/figure/characterRandom.ts) through the same gates and writes nothing.
// Run it after changing randomSpec or adding an option it can now roll.
//
// Re-run after adding/changing a preset or a figure-builder change that alters
// how presets look (thumbnails are baked snapshots — they don't refresh on
// their own). SDF figures take ~10-20 s each to mesh.
import { resolve, dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import sharp from 'sharp';
import { createPreviewSession, composePng } from './cli/preview.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(ROOT, 'public/character-presets');
// Front-¾ from slightly above: shows face, hair and outfit together. In the
// preview rasterizer (scripts/cli/views.mjs) az -90 looks from −Y; a spec with
// `place: true` (the v2 default) faces +X, so its front is az 0.
const viewFor = (spec) => [{ az: spec.place ? 22 : -68, el: 10 }];

// Minimum paintable triangles for a face label to count as visible (a buried
// feature paints 0 to a few dozen; a visible one ~1,000+).
const MIN_FACE_LABEL_TRIS = 200;

// Random rolls only WARN on buried brows: a builder issue sinks them under the
// brow ridge on ~7% of rolls with no single trait to exclude (seeds in
// kemper/partwright#1084). Presets stay strict.
const RANDOM_WARN_ONLY = new Set(['brows']);

function faceLabelProblems(spec, labels) {
  const counts = new Map((labels || []).map((l) => [l.name, l.triangleCount]));
  // Bead eyes are one gloss (no iris/pupil labels); a mouthless toy has no lips.
  const required = ['eyes', 'brows'];
  if (spec.face.mouth) required.push('lips');
  if (spec.face.eyeStyle === 'iris' && spec.face.lids !== 'closed') required.push('iris', 'pupil');
  return required
    .filter((name) => (counts.get(name) ?? 0) < MIN_FACE_LABEL_TRIS)
    .map((name) => `${name}=${counts.get(name) ?? 0} tris`);
}

function parseArgs(argv) {
  const a = { only: null, size: 360, random: 0, seedStart: 1 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--only') a.only = new Set(argv[++i].split(','));
    else if (argv[i] === '--size') a.size = parseInt(argv[++i], 10);
    else if (argv[i] === '--random') a.random = parseInt(argv[++i], 10);
    else if (argv[i] === '--seed-start') a.seedStart = parseInt(argv[++i], 10);
  }
  return a;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent', optimizeDeps: { noDiscovery: true } });
  const { CHARACTER_PRESETS } = await server.ssrLoadModule('/src/figure/characterSpec.ts');
  const { specToCode } = await server.ssrLoadModule('/src/figure/characterCodegen.ts');
  const { randomSpec, seededRandom } = await server.ssrLoadModule('/src/figure/characterRandom.ts');
  await server.close();

  // Either the presets (writing thumbnails) or N seeded random rolls (check only).
  const items = args.random > 0
    ? Array.from({ length: args.random }, (_, i) => {
      const seed = args.seedStart + i;
      return { id: `seed ${seed}`, patch: () => randomSpec(seededRandom(seed)), check: true };
    })
    : CHARACTER_PRESETS.filter((p) => !args.only || args.only.has(p.id));

  mkdirSync(OUT_DIR, { recursive: true });
  const failures = [];
  for (const p of items) {
    const t0 = Date.now();
    // A fresh engine per figure: one long-lived WASM heap runs out after ~a
    // dozen heavy SDF figures ("table index is out of bounds").
    const session = await createPreviewSession();
    try {
      const r = await session.preview(specToCode(p.patch()));
      const s = r.ok ? r.stats : null;
      if (!r.ok || !s.isManifold || s.componentCount !== 1 || !r.render) {
        failures.push(`${p.id}: ${r.ok ? `isManifold=${s.isManifold} components=${s.componentCount}` : r.error}`);
        console.error(`FAIL ${p.id}`);
        continue;
      }
      // Face features must actually show: a buried label (lids swallowing the
      // pupil, a brow sunk under the ridge) still builds manifold but bakes a
      // blank face. Fail well below the ~1k+ triangles a visible one paints.
      const problems = faceLabelProblems(p.patch(), s.labels);
      const warnOnly = p.check ? problems.filter((x) => RANDOM_WARN_ONLY.has(x.split('=')[0])) : [];
      if (warnOnly.length) console.error(`warn ${p.id}: buried ${warnOnly.join(', ')}`);
      const buried = problems.filter((x) => !warnOnly.includes(x));
      if (buried.length) {
        failures.push(`${p.id}: buried face features — ${buried.join(', ')}`);
        console.error(`FAIL ${p.id}`);
        continue;
      }
      if (p.check) {
        const sp = p.patch();
        console.log(`ok   ${p.id}  ${((Date.now() - t0) / 1000).toFixed(1)}s  ${sp.body.proportions}/${sp.hair.style}/${sp.pose.preset}${sp.pose.hold.kind === 'ball' ? '+ball' : ''}`);
        continue;
      }
      const { positions, triVerts, triColors, bbox } = r.render;
      const png = await composePng(positions, triVerts, triColors, bbox, args.size, viewFor(p.patch())).toBuffer();
      const out = resolve(OUT_DIR, `${p.id}.webp`);
      // Trim the empty margin, then fit a fixed card size on the render's own
      // background so every thumbnail lines up.
      await sharp(png)
        .trim({ threshold: 4 })
        .resize(160, 160, { fit: 'contain', background: { r: 244, g: 244, b: 246 } })
        .webp({ quality: 82 })
        .toFile(out);
      console.log(`ok   ${p.id}  ${((Date.now() - t0) / 1000).toFixed(1)}s  ${s.triangleCount} tris`);
    } finally {
      await session.close();
    }
  }
  if (failures.length) {
    console.error(`\n${failures.length} ${args.random ? 'roll' : 'preset'}(s) failed:\n  ${failures.join('\n  ')}`);
    process.exit(1);
  }
}
main().catch((e) => { console.error('bake-character-presets failed:', e?.stack || e?.message || e); process.exit(1); });
