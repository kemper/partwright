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

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

const SOURCE = arg('source');
const NAME = arg('name');
const LANG = arg('lang', 'manifold-js');
const OUT = arg('out');
const BASE_URL = arg('base', 'http://localhost:5173');
// Optional palette: paints api.label() regions AFTER the run, then re-snapshots
// the colored viewport (so the catalog thumbnail is colored). Needed for scad &
// replicad, whose label() carries no baked color. Pass either:
//   --palette '{"cowling":"#c9ccd1","blades":"#5a7fb0"}'   (inline JSON)
//   --palette-file path/to/palette.json
const PALETTE_FILE = arg('palette-file');
let PALETTE = null;
try {
  const raw = PALETTE_FILE ? fs.readFileSync(PALETTE_FILE, 'utf8') : arg('palette');
  if (raw) PALETTE = JSON.parse(raw);
} catch (e) { console.error('Bad --palette JSON: ' + e); process.exit(2); }

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

if (!SOURCE || !NAME || !OUT) {
  console.error('Required: --source <file> --name <name> --out <file> [--lang manifold-js|scad|replicad|voxel] [--palette JSON | --palette-file FILE]');
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
  const code = fs.readFileSync(SOURCE, 'utf8');

  const browser = await chromium.launch({
    headless: false,
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
      result = await page.evaluate(async ({ code, lang, name, paintItems }) => {
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
        const r = await window.partwright.runAndSave(code, 'v0', {});
        if (r && r.error) return { error: r.error, where: 'runAndSave' };
        if (!r || !r.version) return { error: 'no version saved: ' + JSON.stringify(r).slice(0, 500), where: 'runAndSave' };
        const geo = r.geometry || {};

        // Optional: paint api.label() regions, then re-snapshot a colored version
        // (scad/replicad label() carries no baked color, so the catalog tile would
        // otherwise be gray). manifold-js api.label({color}) already bakes color.
        let labelInfo = null, paintInfo = null;
        if (paintItems && paintItems.length) {
          const ll = window.partwright.listLabels();
          labelInfo = { count: ll && ll.count, labels: ll && ll.labels && ll.labels.map((l) => l.name), lostLabels: ll && ll.lostLabels };
          paintInfo = window.partwright.paintByLabels(paintItems);
          await window.partwright.commitWithColors({ label: 'painted' });
        }

        const data = await window.partwright.exportSession(undefined, { includeThumbnails: true });
        if (data && data.error) return { error: data.error, where: 'export' };
        return { ok: true, data, labelInfo, paintInfo, stats: {
          status: geo.status, isManifold: geo.isManifold, componentCount: geo.componentCount,
          triangleCount: geo.triangleCount, genus: geo.genus, volume: geo.volume,
        } };
      }, { code, lang: LANG, name: NAME, paintItems: PAINT_ITEMS });
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
  console.log(`OK ${OUT} (${sizeKb} KB) stats=${JSON.stringify(result.stats)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
