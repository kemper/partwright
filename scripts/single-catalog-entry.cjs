#!/usr/bin/env node
/* eslint-disable */
// Drives a running dev server with Playwright to produce ONE catalog
// entry's `.partwright.json` (with a real rendered thumbnail), then
// updates `public/catalog/manifest.json` to include it.
//
// Usage:
//   node scripts/single-catalog-entry.cjs <code-file> <slug> <name> <language> "<description>" [paint-file]
//
//   code-file   — path to a file holding the model's JavaScript / SCAD source.
//   slug        — kebab-case id (e.g. "industrial-flange").
//   name        — display name (e.g. "Industrial Flange").
//   language    — "manifold-js" | "scad" | "replicad".
//   description — short blurb shown on the catalog tile.
//   paint-file  — OPTIONAL path to a JavaScript file holding paint
//                 operations. The file's source is executed as an async
//                 function body inside the page, AFTER runAndSave(v0)
//                 succeeds. It can call any window.partwright.paint*
//                 method. A "colored" version is then saved so the
//                 catalog thumbnail captures the colors. Inside the file
//                 you have access to `partwright` (alias for
//                 window.partwright).
//
// Requires `npm run dev` already running on http://localhost:5173.
// Writes <slug-with-underscores>.partwright.json into public/catalog/ and
// merges a manifest entry. Re-running with the same slug overwrites.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const REPO_ROOT = path.resolve(__dirname, '..');
const CATALOG_DIR = path.join(REPO_ROOT, 'public', 'catalog');
const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';

// Mirror playwright.config.ts's binary-detection: in the sandbox image the
// chromium pinned by the npm package may not be present, but a slightly
// older chromium-XXXX is — sniff the highest version installed.
function findChromiumExecutable() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
    return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  }
  const root = '/opt/pw-browsers';
  if (!fs.existsSync(root)) return undefined;
  const versions = fs.readdirSync(root)
    .filter((d) => /^chromium-\d+$/.test(d))
    .map((d) => ({ dir: d, n: parseInt(d.split('-')[1], 10) }))
    .sort((a, b) => b.n - a.n);
  for (const { dir } of versions) {
    const chrome = path.join(root, dir, 'chrome-linux', 'chrome');
    if (fs.existsSync(chrome)) return chrome;
  }
  return undefined;
}

async function main() {
  const [, , codeFile, slug, name, language, description, paintFile] = process.argv;
  if (!codeFile || !slug || !name || !language || !description) {
    console.error('Usage: node scripts/single-catalog-entry.cjs <code-file> <slug> <name> <language> "<description>" [paint-file]');
    process.exit(2);
  }
  if (!['manifold-js', 'scad', 'replicad'].includes(language)) {
    console.error(`Unknown language: ${language}. Use one of manifold-js, scad, replicad.`);
    process.exit(2);
  }
  const code = fs.readFileSync(codeFile, 'utf8');
  const paintBody = paintFile ? fs.readFileSync(paintFile, 'utf8') : null;
  const fileBase = slug.replace(/-/g, '_');
  const outPath = path.join(CATALOG_DIR, `${fileBase}.partwright.json`);

  if (!fs.existsSync(CATALOG_DIR)) fs.mkdirSync(CATALOG_DIR, { recursive: true });

  const executablePath = findChromiumExecutable();
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist'],
    ...(executablePath ? { executablePath } : {}),
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error('  page error:', msg.text());
  });

  console.log(`→ ${BASE_URL}/editor (${name}, ${language})`);
  await page.goto(`${BASE_URL}/editor`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window.partwright && window.partwright.runAndSave), null, { timeout: 30000 });

  const result = await page.evaluate(async ({ name, language, code, paintBody }) => {
    if (window.partwright.getActiveLanguage() !== language) {
      await window.partwright.setActiveLanguage(language);
    }
    // Warmup: probe each engine with a trivial program so its WASM is
    // loaded before the real run (the BREP and SCAD bundles are lazy).
    const probe =
      language === 'scad' ? 'cube([1, 1, 1], center=true);'
      : language === 'replicad' ? 'const { BREP } = api; return BREP.box([1, 1, 1]);'
      : 'return api.Manifold.cube([1, 1, 1], true);';
    let warmed = false;
    for (let i = 0; i < 60; i++) {
      const p = await window.partwright.runAndSave(probe, 'probe', {});
      if (p && !p.error && p.version) { warmed = true; break; }
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (!warmed) return { error: 'engine warmup timeout' };
    await window.partwright.createSession(name);
    const r = await window.partwright.runAndSave(code, 'v0', {});
    if (r && r.error) return { error: r.error, geometry: r.geometry };
    if (!r || !r.version) return { error: 'no version saved: ' + JSON.stringify(r).slice(0, 400) };
    // Optional paint phase — run the paint script as an async function
    // body with `partwright` bound, then save a fresh version so the
    // thumbnail captures the colors (catalog uses the latest version's
    // thumbnail).
    let paintReport = null;
    if (paintBody) {
      try {
        const paintFn = new Function('partwright', `return (async () => { ${paintBody} })();`);
        const paintResult = await paintFn(window.partwright);
        paintReport = { ok: true, returned: paintResult };
      } catch (e) {
        return { error: 'paint phase threw: ' + (e && e.message ? e.message : String(e)) };
      }
      // Per the lighthouse fix-up agent's finding: saveVersion('colored')
      // immediately after a paint pass can capture a NULL thumbnail because
      // the live viewport hasn't re-rendered yet. Wait for one paint frame
      // before snapshotting so the saved version carries a usable
      // catalog tile image.
      await new Promise(res => setTimeout(res, 400));
      const r2 = await window.partwright.saveVersion('colored');
      if (r2 && r2.error) return { error: 'saveVersion(colored): ' + r2.error };
      paintReport.savedVersion = r2;
    }
    const data = await window.partwright.exportSession(undefined, { includeThumbnails: true });
    if (data && data.error) return { error: data.error };
    return { ok: true, data, stats: r.geometry, paint: paintReport };
  }, { name, language, code, paintBody });

  await browser.close();

  if (!result.ok) {
    console.error(`✘ failed: ${result.error}`);
    if (result.geometry) {
      console.error(`  geometry status: ${result.geometry.status}`);
      if (result.geometry.diagnostics) {
        console.error(`  diagnostics: ${JSON.stringify(result.geometry.diagnostics).slice(0, 600)}`);
      }
    }
    process.exit(1);
  }

  fs.writeFileSync(outPath, JSON.stringify(result.data, null, 2) + '\n');
  const sizeKb = (fs.statSync(outPath).size / 1024).toFixed(0);
  console.log(`✔  wrote ${outPath} (${sizeKb} KB)`);
  console.log('  stats:', JSON.stringify({
    triangles: result.stats?.triangleCount,
    bbox: result.stats?.boundingBox?.dimensions,
    isManifold: result.stats?.isManifold,
    componentCount: result.stats?.componentCount,
    volume: result.stats?.volume,
  }));
  if (result.paint) {
    console.log('  paint phase:', JSON.stringify(result.paint).slice(0, 400));
  }

  // Merge into manifest.json
  const manifestPath = path.join(CATALOG_DIR, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const entry = { id: slug, name, file: `${fileBase}.partwright.json`, language, description };
  const idx = manifest.entries.findIndex((e) => e.id === slug);
  if (idx >= 0) {
    manifest.entries[idx] = entry;
    console.log(`✔  updated manifest entry "${slug}"`);
  } else {
    manifest.entries.push(entry);
    console.log(`✔  appended manifest entry "${slug}"`);
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
