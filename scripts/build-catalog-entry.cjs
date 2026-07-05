#!/usr/bin/env node
/* eslint-disable */
// Build ONE catalog `.partwright.json` from a code file by driving a running
// dev server with Playwright (real WebGL for the thumbnail). Does NOT touch
// manifest.json — that is updated separately so parallel/iterative runs can't
// clobber it.
//
// Usage:
//   npm run dev                      # in another terminal (or auto-detected)
//   node scripts/build-catalog-entry.cjs \
//     --source examples/foo.js --name "Foo" --lang manifold-js \
//     --out public/catalog/foo.partwright.json [--base http://localhost:5173]
//
// Exits non-zero on any engine error so callers can detect a broken model.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { paletteFromEntry } = require('./lib/catalog-palette.cjs');

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

const SOURCE = arg('source');
const NAME = arg('name');
const LANG = arg('lang', 'manifold-js');
const OUT = arg('out');
const BASE_URL = arg('base', 'http://localhost:5173');
// Multi-part mode: --parts-manifest <file.json> bakes ONE session with a part
// per manifest entry (shown in the editor's part list). The JSON is an array
// of { name, source, expectComponents? } in display order; the LAST part's
// thumbnail becomes the catalog tile. Mutually exclusive with --source.
// expectComponents (optional) gates that part's baked componentCount exactly —
// the print-correctness check for "this part is N pieces" (e.g. ×2 copies).
const PARTS_MANIFEST = arg('parts-manifest');
let PARTS = null;
if (PARTS_MANIFEST) {
  if (SOURCE) { console.error('--parts-manifest cannot be combined with --source'); process.exit(2); }
  try {
    PARTS = JSON.parse(fs.readFileSync(PARTS_MANIFEST, 'utf8'));
    if (!Array.isArray(PARTS) || !PARTS.length) throw new Error('manifest must be a non-empty array');
    for (const p of PARTS) {
      if (!p.name || !p.source) throw new Error('each part needs {name, source}');
      p.code = fs.readFileSync(p.source, 'utf8');
    }
  } catch (e) { console.error('Bad --parts-manifest: ' + e); process.exit(2); }
}
// Optional palette: paints api.label() regions AFTER the run, then re-snapshots
// the colored viewport (so the catalog thumbnail is colored). Needed for scad &
// replicad, whose label() carries no baked color. Pass either:
//   --palette '{"cowling":"#c9ccd1","blades":"#5a7fb0"}'   (inline JSON)
//   --palette-file path/to/palette.json
//   --palette-from-existing path/to/old-entry.partwright.json
// The last form recovers the palette from a previously baked entry's byLabel
// colorRegions — the standard way to re-bake an entry whose palette file was
// never committed. Committed palettes live in public/catalog/palettes/
// (regenerate with scripts/extract-catalog-palettes.cjs).
const PALETTE_FILE = arg('palette-file');
const PALETTE_FROM = arg('palette-from-existing');
if (PALETTE_FROM && (PALETTE_FILE || arg('palette'))) {
  console.error('--palette-from-existing cannot be combined with --palette/--palette-file');
  process.exit(2);
}
let PALETTE = null;
try {
  const raw = PALETTE_FILE ? fs.readFileSync(PALETTE_FILE, 'utf8') : arg('palette');
  if (raw) PALETTE = JSON.parse(raw);
} catch (e) { console.error('Bad --palette JSON: ' + e); process.exit(2); }
if (PALETTE_FROM) {
  try {
    PALETTE = paletteFromEntry(JSON.parse(fs.readFileSync(PALETTE_FROM, 'utf8')));
    if (!PALETTE) throw new Error('no byLabel colorRegions found in any version');
    console.log(`   palette from ${PALETTE_FROM}: ${JSON.stringify(PALETTE)}`);
  } catch (e) { console.error('Bad --palette-from-existing: ' + e); process.exit(2); }
}

// Gates (exit non-zero so CI / bake loops catch regressions mechanically):
//   --max-genus N            fail if the baked solid's genus exceeds N
//   --require-labels a,b,c   fail if any listed label is missing — or, when a
//                            palette is given, resolves to 0 painted triangles
//                            (a buried/aliased-away feature)
const hasFlag = (name) => process.argv.includes(`--${name}`);
// hasFlag (not arg()) so a dangling `--max-genus` with no value errors instead
// of silently disabling the gate.
const MAX_GENUS = hasFlag('max-genus') ? Number(arg('max-genus')) : undefined;
if (MAX_GENUS !== undefined && !Number.isFinite(MAX_GENUS)) {
  console.error('--max-genus must be a number');
  process.exit(2);
}
const REQUIRE_LABELS = (arg('require-labels') || '')
  .split(',').map((s) => s.trim()).filter(Boolean);
if (hasFlag('require-labels') && !REQUIRE_LABELS.length) {
  console.error('--require-labels needs a comma-separated label list');
  process.exit(2);
}

// hex '#rrggbb' -> [r,g,b] in 0..1 (paintByLabels color format)
function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) throw new Error('palette colors must be #rrggbb, got: ' + hex);
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
const PAINT_ITEMS = PALETTE
  ? Object.entries(PALETTE).map(([label, hex]) => ({ label, color: hexToRgb(hex) }))
  : null;

// Optional thumbnail-camera pin (mirrors single-catalog-entry.cjs): set
// THUMB_AZIMUTH / THUMB_ELEVATION (degrees; azimuth 0=front/−Y, 90=right/+X,
// 180=back/+Y; elevation 0=horizon, 90=top — see STANDARD_VIEWS in
// src/renderer/multiview.ts) to bake the tile from a chosen angle instead of
// the default iso (az 45 / el 35) — no need to bake orientation into geometry.
const THUMB_AZ = process.env.THUMB_AZIMUTH !== undefined ? Number(process.env.THUMB_AZIMUTH) : undefined;
const THUMB_EL = process.env.THUMB_ELEVATION !== undefined ? Number(process.env.THUMB_ELEVATION) : undefined;
const THUMB_CAMERA = (Number.isFinite(THUMB_AZ) || Number.isFinite(THUMB_EL))
  ? { ...(Number.isFinite(THUMB_AZ) ? { azimuth: THUMB_AZ } : {}), ...(Number.isFinite(THUMB_EL) ? { elevation: THUMB_EL } : {}) }
  : null;

if ((!SOURCE && !PARTS) || !NAME || !OUT) {
  console.error('Required: (--source <file> | --parts-manifest <file.json>) --name <name> --out <file> [--lang manifold-js|scad|replicad|voxel] [--palette JSON | --palette-file FILE | --palette-from-existing ENTRY.json]');
  console.error('Gates: [--max-genus N] [--require-labels a,b,c]  (multi-part: per-part expectComponents in the manifest)');
  console.error('Optional env: THUMB_AZIMUTH / THUMB_ELEVATION (degrees) — pin the thumbnail camera.');
  process.exit(2);
}

// Sandbox Chromium under /opt/pw-browsers (no system Chrome). Headed for real GL.
const SANDBOX_CHROME = (() => {
  const root = '/opt/pw-browsers';
  try {
    const dir = fs.readdirSync(root).find((d) => /^chromium-\d+$/.test(d));
    if (dir) {
      const p = path.join(root, dir, 'chrome-linux', 'chrome');
      if (fs.existsSync(p)) return p;
    }
  } catch {}
  return undefined;
})();

async function main() {
  const code = SOURCE ? fs.readFileSync(SOURCE, 'utf8') : null;

  const browser = await chromium.launch({
    headless: true,
    executablePath: SANDBOX_CHROME,
    args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist', '--no-sandbox'],
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error('  page error:', msg.text().slice(0, 200));
  });

  let result;
  let attempt = 0;
  while (attempt < 3) {
    attempt++;
    try {
      await page.goto(`${BASE_URL}/editor`, { waitUntil: 'domcontentloaded' });
    } catch {}
    try {
      await page.waitForFunction(() => !!(window.partwright && window.partwright.runAndSave), null, { timeout: 30000 });
    } catch {
      result = { error: 'API never appeared', where: 'init' };
      continue;
    }
    try {
      result = await page.evaluate(async ({ code, parts, lang, name, paintItems, thumbCamera }) => {
        if (window.partwright.getActiveLanguage() !== lang) {
          await window.partwright.setActiveLanguage(lang);
        }
        const probe = lang === 'scad'
          ? 'cube([1, 1, 1], center=true);'
          : lang === 'replicad'
            ? 'const { BREP } = api; return BREP.box([1,1,1]);'
            : lang === 'voxel'
              ? 'const { voxels } = api; const v = voxels(); v.fillBox([0,0,0],[1,1,1],"#888"); return v;'
              : 'return api.Manifold.cube([1, 1, 1], true);';
        let warmed = false;
        for (let i = 0; i < 90; i++) {
          const p = await window.partwright.runAndSave(probe, 'probe', {});
          if (p && !p.error && p.version) { warmed = true; break; }
          await new Promise((r) => setTimeout(r, 1000));
        }
        if (!warmed) return { error: 'engine warmup timeout', where: 'warmup' };
        await window.partwright.createSession(name);
        if (thumbCamera && window.partwright.setThumbnailCamera) {
          await window.partwright.setThumbnailCamera(thumbCamera);
        }
        let geo = {};
        let partStats = null;
        if (parts) {
          // Multi-part session: one part-list part per manifest entry. The
          // session starts with a default part — rename it for the first
          // entry, createPart for the rest (createPart also switches to it).
          partStats = [];
          for (let i = 0; i < parts.length; i++) {
            if (i === 0) {
              const rn = await window.partwright.renamePart(0, parts[i].name);
              if (rn && rn.error) return { error: rn.error, where: 'renamePart ' + parts[i].name };
            } else {
              const cp = await window.partwright.createPart(parts[i].name);
              if (cp && cp.error) return { error: cp.error, where: 'createPart ' + parts[i].name };
            }
            const r = await window.partwright.runAndSave(parts[i].code, 'v0', {});
            if (r && r.error) return { error: r.error, where: 'runAndSave ' + parts[i].name };
            if (!r || !r.version) return { error: 'no version saved for part ' + parts[i].name, where: 'runAndSave' };
            geo = r.geometry || {};
            partStats.push({ name: parts[i].name, componentCount: geo.componentCount, isManifold: geo.isManifold, triangleCount: geo.triangleCount });
          }
        } else {
          const r = await window.partwright.runAndSave(code, 'v0', {});
          if (r && r.error) return { error: r.error, where: 'runAndSave' };
          if (!r || !r.version) return { error: 'no version saved: ' + JSON.stringify(r).slice(0, 500), where: 'runAndSave' };
          geo = r.geometry || {};
        }

        // Label inventory is always collected (the --require-labels gate needs
        // it even for unpainted bakes).
        const ll = window.partwright.listLabels();
        const labelInfo = { count: ll && ll.count, labels: ll && ll.labels && ll.labels.map((l) => l.name), lostLabels: ll && ll.lostLabels };

        // Optional: paint api.label() regions, then re-snapshot a colored version
        // (scad/replicad label() carries no baked color, so the catalog tile would
        // otherwise be gray). manifold-js api.label({color}) already bakes color.
        let paintInfo = null;
        if (paintItems && paintItems.length) {
          paintInfo = window.partwright.paintByLabels(paintItems);
          await window.partwright.commitWithColors({ label: 'painted' });
        }

        const data = await window.partwright.exportSession(undefined, { includeThumbnails: true });
        if (data && data.error) return { error: data.error, where: 'export' };
        return { ok: true, data, labelInfo, paintInfo, partStats, stats: {
          status: geo.status, isManifold: geo.isManifold, componentCount: geo.componentCount,
          triangleCount: geo.triangleCount, genus: geo.genus, volume: geo.volume,
        } };
      }, { code, parts: PARTS && PARTS.map((p) => ({ name: p.name, code: p.code })), lang: LANG, name: NAME, paintItems: PAINT_ITEMS, thumbCamera: THUMB_CAMERA });
      break;
    } catch (e) {
      result = { error: String(e), where: 'eval' };
    }
  }

  await browser.close();

  if (!result || !result.ok) {
    console.error(`FAIL [${result && result.where}]: ${result && result.error}`);
    process.exit(1);
  }

  // --- Gates: fail BEFORE writing OUT so a regressed bake can't be committed.
  const gateFailures = [];
  if (PARTS && result.partStats) {
    for (let i = 0; i < PARTS.length; i++) {
      const expect = PARTS[i].expectComponents;
      const got = result.partStats[i] && result.partStats[i].componentCount;
      if (expect !== undefined && got !== expect) {
        gateFailures.push(`part '${PARTS[i].name}': expectComponents ${expect}, baked ${got}`);
      }
      if (result.partStats[i] && result.partStats[i].isManifold === false) {
        gateFailures.push(`part '${PARTS[i].name}': not manifold`);
      }
    }
  }
  if (MAX_GENUS !== undefined) {
    const genus = result.stats && result.stats.genus;
    if (!Number.isFinite(genus)) {
      // genus is only computed for manifold mesh entries — voxel and
      // render-only bakes report null. Fail closed (it's a quality gate),
      // but say why so the caller drops the flag rather than chasing a bug.
      gateFailures.push(`--max-genus ${MAX_GENUS}: genus not computed for this bake (only manifold mesh entries have one — drop the flag for voxel/render-only models)`);
    } else if (genus > MAX_GENUS) {
      gateFailures.push(`--max-genus ${MAX_GENUS}: baked genus is ${genus}`);
    }
  }
  if (REQUIRE_LABELS.length) {
    const present = new Set((result.labelInfo && result.labelInfo.labels) || []);
    const lost = new Set((result.labelInfo && result.labelInfo.lostLabels) || []);
    const paintFailed = new Set(((result.paintInfo && result.paintInfo.failed) || []).map((f) => f.label));
    for (const label of REQUIRE_LABELS) {
      if (!present.has(label)) gateFailures.push(`--require-labels: '${label}' missing (labels: ${[...present].join(', ') || 'none'})`);
      else if (lost.has(label)) gateFailures.push(`--require-labels: '${label}' was lost (resolved to no surface)`);
      else if (paintFailed.has(label)) gateFailures.push(`--require-labels: paint for '${label}' resolved to 0 triangles (buried/aliased-away feature)`);
    }
  }
  if (gateFailures.length) {
    if (result.labelInfo) console.error(`   labels=${JSON.stringify(result.labelInfo)}`);
    console.error(`   stats=${JSON.stringify(result.stats)}`);
    for (const g of gateFailures) console.error(`GATE FAIL: ${g}`);
    console.error(`FAIL [gates]: ${gateFailures.length} gate(s) failed — entry NOT written`);
    process.exit(1);
  }

  // Multi-part entries: keep only the LAST version's thumbnail (the catalog
  // tile). Per-part thumbnails are ~60KB each and regenerate on first run in
  // the editor — 21 of them pushed the dummy13 kit past the entry size gate.
  if (PARTS && Array.isArray(result.data.versions)) {
    const vs = result.data.versions;
    for (let i = 0; i < vs.length - 1; i++) delete vs[i].thumbnail;
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(result.data, null, 2) + '\n');
  const sizeKb = (fs.statSync(OUT).size / 1024).toFixed(0);

  // Also dump the embedded thumbnail as a sibling .png for quick eyes-on review.
  try {
    const versions = result.data.versions || [];
    const thumb = versions.length ? versions[versions.length - 1].thumbnail : null;
    if (thumb && thumb.startsWith('data:image')) {
      const pngPath = OUT.replace(/\.partwright\.json$/, '') + '.thumb.png';
      fs.writeFileSync(pngPath, Buffer.from(thumb.split(',', 2)[1], 'base64'));
      console.log(`   thumbnail -> ${pngPath}`);
    }
  } catch (e) { console.error('   (thumbnail dump failed: ' + e + ')'); }

  if (result.labelInfo) console.log(`   labels=${JSON.stringify(result.labelInfo)}`);
  if (result.paintInfo && result.paintInfo.failed && result.paintInfo.failed.length)
    console.log(`   PAINT FAILED for: ${JSON.stringify(result.paintInfo.failed)}`);
  if (result.partStats)
    console.log(`   parts=${result.partStats.length}: ${result.partStats.map((p) => `${p.name}:${p.componentCount}`).join('  ')}`);
  console.log(`OK ${OUT} (${sizeKb} KB) stats=${JSON.stringify(result.stats)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
