#!/usr/bin/env node
/* eslint-disable */
// One-off: run a manifold-js source file and dump per-component bounds, so we
// can see which pieces are disconnected (and where they are) when chasing a
// printable single-component model.
//   xvfb-run -a node scripts/probe-components.cjs --source FILE [--lang manifold-js]
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

function arg(n, d) { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; }
const SOURCE = arg('source');
const LANG = arg('lang', 'manifold-js');
const BASE_URL = arg('base', 'http://localhost:5173');

const SANDBOX_CHROME = (() => {
  try { const dir = fs.readdirSync('/opt/pw-browsers').find((d) => /^chromium-\d+$/.test(d));
    const p = path.join('/opt/pw-browsers', dir, 'chrome-linux', 'chrome'); return fs.existsSync(p) ? p : undefined; } catch { return undefined; }
})();

(async () => {
  const code = fs.readFileSync(SOURCE, 'utf8');
  const browser = await chromium.launch({ headless: false, executablePath: SANDBOX_CHROME,
    args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const page = await (await browser.newContext()).newPage();
  await page.goto(`${BASE_URL}/editor`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window.partwright && window.partwright.runAndSave), null, { timeout: 30000 });
  const out = await page.evaluate(async ({ code, lang }) => {
    if (window.partwright.getActiveLanguage() !== lang) await window.partwright.setActiveLanguage(lang);
    for (let i = 0; i < 30; i++) { const p = await window.partwright.runAndSave('return api.Manifold.cube([1,1,1],true);', 'probe', {}); if (p && p.version) break; await new Promise(r => setTimeout(r, 1000)); }
    const r = await window.partwright.runAndSave(code, 'v', {});
    if (r && r.error) return { error: r.error };
    const comps = window.partwright.componentBounds();
    return { count: r.geometry && r.geometry.componentCount, comps };
  }, { code, lang: LANG });
  await browser.close();
  if (out.error) { console.error('RUN ERROR:', out.error); process.exit(1); }
  console.log('componentCount:', out.count);
  const comps = (out.comps || []).slice().sort((a, b) => b.volume - a.volume);
  for (const c of comps) {
    const b = c.bbox;
    console.log(`#${c.index} vol=${c.volume.toFixed(1).padStart(9)} tris=${String(c.triangleCount).padStart(5)} ` +
      `x[${b.min[0].toFixed(1)},${b.max[0].toFixed(1)}] y[${b.min[1].toFixed(1)},${b.max[1].toFixed(1)}] z[${b.min[2].toFixed(1)},${b.max[2].toFixed(1)}]`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
