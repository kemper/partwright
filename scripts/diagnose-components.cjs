#!/usr/bin/env node
/* eslint-disable */
// Fast component diagnostic: runs a code file through the live engine via
// window.partwright.runAndExplain and prints componentCount + floater hints.
// Used while fixing non-manifold catalog entries — much faster than a full
// re-bake. Requires `npm run dev` on http://localhost:5173.
//
//   node scripts/diagnose-components.cjs <code-file> <language>
//     language = manifold-js | scad | replicad

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';

function findChromiumExecutable() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
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
  const [, , codeFile, language] = process.argv;
  if (!codeFile || !language) {
    console.error('Usage: node scripts/diagnose-components.cjs <code-file> <language>');
    process.exit(2);
  }
  const code = fs.readFileSync(codeFile, 'utf8');
  const executablePath = findChromiumExecutable();
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist'],
    ...(executablePath ? { executablePath } : {}),
  });
  const page = await (await browser.newContext()).newPage();
  page.on('console', (msg) => { if (msg.type() === 'error') console.error('  page error:', msg.text()); });

  await page.goto(`${BASE_URL}/editor`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window.partwright && window.partwright.runAndExplain), null, { timeout: 30000 });

  const result = await page.evaluate(async ({ language, code }) => {
    if (window.partwright.getActiveLanguage() !== language) {
      await window.partwright.setActiveLanguage(language);
    }
    const probe =
      language === 'scad' ? 'cube([1, 1, 1], center=true);'
      : language === 'replicad' ? 'const { BREP } = api; return BREP.box([1, 1, 1]);'
      : 'return api.Manifold.cube([1, 1, 1], true);';
    let warmed = false;
    for (let i = 0; i < 60; i++) {
      const p = await window.partwright.runAndExplain(probe);
      if (p && p.stats && p.stats.status === 'ok') { warmed = true; break; }
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (!warmed) return { error: 'engine warmup timeout' };
    return await window.partwright.runAndExplain(code);
  }, { language, code });

  await browser.close();

  if (result.error) { console.error('✘', result.error); process.exit(1); }
  const s = result.stats || {};
  console.log(JSON.stringify({
    status: s.status,
    isManifold: s.isManifold,
    componentCount: s.componentCount,
    genus: s.genus,
    volume: s.volume,
    triangleCount: s.triangleCount,
    boundingBox: s.boundingBox,
  }, null, 2));
  if (result.components) {
    console.log('\nCOMPONENTS:');
    for (const c of result.components) {
      console.log(`  [${c.index}] vol=${c.volume} centroid=[${c.centroid}] bbox.min=[${c.boundingBox.min.map(n=>n.toFixed(1))}] bbox.max=[${c.boundingBox.max.map(n=>n.toFixed(1))}]`);
    }
  }
  if (result.hints) { console.log('\nHINTS:'); for (const h of result.hints) console.log('  ' + h); }
}

main().catch((e) => { console.error(e); process.exit(1); });
