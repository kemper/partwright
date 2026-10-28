import { test, expect, type Page } from 'playwright/test';
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// SES sandbox (#1127) benchmarks — OPT-IN, not part of the default suite:
//
//   SES_SWEEP=1 E2E_PORT=5291 npx playwright test ses-bench --grep sweep
//     Runs every public/catalog entry (latest version, stored language) with
//     SES on and with the kill switch off, and fails if any entry that runs in
//     one mode fails in the other or produces a different triangle count /
//     volume. ~35-45 min. Results: <SES_BENCH_OUT>/ses-sweep-{on,off}.json.
//     SES_SWEEP_ONLY=a,b limits it to those entries.
//
//   SES_PERF=1 E2E_PORT=5291 npx playwright test ses-bench --grep perf
//     Worker init time (fresh Worker per sample) and per-run Worker time for a
//     trivial cube, a ~150k-tri union, a levelSet with a model-code closure, an
//     SDF figure and a BOSL2 model, SES on vs off. Prints a table and writes
//     <SES_BENCH_OUT>/ses-perf.json.
//
// SES_BENCH_OUT defaults to .ses-bench/ (gitignored; not test-results/, which
// Playwright wipes at the start of every run). See docs/engine-sandbox.md.

const OUT = process.env.SES_BENCH_OUT ?? '.ses-bench';

type Mode = 'on' | 'off';

async function boot(page: Page, mode: Mode): Promise<void> {
  await page.addInitScript((m) => {
    if (window !== window.top) return;
    try { localStorage.setItem('partwright.sesSandbox', m); } catch { /* ignore */ }
  }, mode);
  await page.goto('/editor');
  await page.waitForFunction(() => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run, undefined, { timeout: 90_000 });
}

interface RunOut { error: string | null; numTri: number | null; volume: number | null; wallMs: number; workerMs: number | null }

/** runModel, retried once when the dev server reloads the page under us
 *  (Vite discovering a lazily-imported dependency, e.g. OCCT, mid-run). */
async function runModel(page: Page, code: string, lang: string, timeoutMs = 240_000): Promise<RunOut> {
  try {
    return await runModelOnce(page, code, lang, timeoutMs);
  } catch (err) {
    if (!/Execution context was destroyed|navigation/i.test(String(err))) throw err;
    await page.waitForFunction(() => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run, undefined, { timeout: 90_000 });
    return runModelOnce(page, code, lang, timeoutMs);
  }
}

async function runModelOnce(page: Page, code: string, lang: string, timeoutMs: number): Promise<RunOut> {
  return page.evaluate(async ({ code, lang, timeoutMs }) => {
    const e = await import('/src/geometry/engine.ts');
    const stats = await import('/src/diagnostics/workerStats.ts');
    const t0 = performance.now();
    let r;
    try {
      r = await Promise.race([
        e.executeCodeAsync(code, lang as never),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('TIMEOUT')), timeoutMs)),
      ]);
    } catch (err) {
      return { error: 'THREW: ' + (err instanceof Error ? err.message : String(err)), numTri: null, volume: null, wallMs: performance.now() - t0, workerMs: null };
    }
    const wallMs = performance.now() - t0;
    let volume: number | null = null;
    const m = r.mesh;
    if (m) {
      const vp = m.vertProperties, tv = m.triVerts, np = m.numProp;
      let v = 0;
      for (let i = 0; i < tv.length; i += 3) {
        const a = tv[i] * np, b = tv[i + 1] * np, c = tv[i + 2] * np;
        v += vp[a] * (vp[b + 1] * vp[c + 2] - vp[b + 2] * vp[c + 1])
          - vp[a + 1] * (vp[b] * vp[c + 2] - vp[b + 2] * vp[c])
          + vp[a + 2] * (vp[b] * vp[c + 1] - vp[b + 1] * vp[c]);
      }
      volume = v / 6;
    }
    const last = stats.getWorkerRuns().find((x: { worker: string }) => x.worker === 'geometry') as { workerMs?: number } | undefined;
    return { error: r.error ?? null, numTri: m ? m.numTri : null, volume, wallMs, workerMs: last?.workerMs ?? null };
  }, { code, lang, timeoutMs });
}

function catalogCode(name: string): { code: string; lang: string } {
  const d = JSON.parse(readFileSync(`public/catalog/${name}.partwright.json`, 'utf8'));
  const v = d.versions[d.versions.length - 1];
  return { code: v.code, lang: v.language ?? d.session?.language ?? 'manifold-js' };
}

test.describe('SES benchmarks (opt-in)', () => {
  test('sweep: every catalog entry renders identically with SES on and off', async ({ browser }) => {
    test.skip(!process.env.SES_SWEEP, 'catalog sweep — set SES_SWEEP=1');
    test.setTimeout(4 * 3_600_000);
    mkdirSync(OUT, { recursive: true });
    const only = process.env.SES_SWEEP_ONLY?.split(',');
    const names = readdirSync('public/catalog').filter(f => f.endsWith('.partwright.json')).map(f => f.replace('.partwright.json', ''))
      .filter(n => !only || only.includes(n)).sort();
    const results: Record<Mode, Record<string, RunOut>> = { on: {}, off: {} };
    for (const mode of ['on', 'off'] as const) {
      const ctx = await browser.newContext();
      let page = await ctx.newPage();
      await boot(page, mode);
      for (const n of names) {
        const { code, lang } = catalogCode(n);
        results[mode][n] = await runModel(page, code, lang, 180_000);
        console.log(`[sweep ${mode}] ${n}: ${results[mode][n].error ? 'ERR ' + String(results[mode][n].error).slice(0, 120) : `tri=${results[mode][n].numTri} ${results[mode][n].workerMs}ms`}`);
        if (String(results[mode][n].error).startsWith('THREW')) {
          // Worker torn down (timeout / crash): start over in a fresh page.
          await page.close();
          page = await ctx.newPage();
          await boot(page, mode);
        }
        writeFileSync(join(OUT, `ses-sweep-${mode}.json`), JSON.stringify(results[mode], null, 1));
      }
      await ctx.close();
    }
    const diffs: string[] = [];
    let identical = 0;
    let bothFail = 0;
    for (const n of names) {
      const a = results.on[n], b = results.off[n];
      if (a.error && b.error) { bothFail++; continue; }
      if (!!a.error !== !!b.error) { diffs.push(`${n}: on=${a.error ?? 'ok'} off=${b.error ?? 'ok'}`); continue; }
      const sameVol = a.volume === b.volume || Math.abs((a.volume ?? 0) - (b.volume ?? 0)) <= 1e-6 * Math.max(1, Math.abs(b.volume ?? 0));
      if (a.numTri !== b.numTri || !sameVol) diffs.push(`${n}: tri ${a.numTri} vs ${b.numTri}, vol ${a.volume} vs ${b.volume}`);
      else identical++;
    }
    const ratios = names.map(n => [results.on[n].workerMs, results.off[n].workerMs]).filter(([a, b]) => a !== null && b !== null && (b as number) > 200).map(([a, b]) => (a as number) / (b as number)).sort((x, y) => x - y);
    const q = (p: number) => ratios.length ? ratios[Math.min(ratios.length - 1, Math.floor(p * ratios.length))].toFixed(2) : 'n/a';
    console.log(`[sweep] ${names.length} entries: ${identical} identical, ${diffs.length} different, ${bothFail} failing in both modes`);
    console.log(`[sweep] SES/off worker time over ${ratios.length} models >200ms: median ${q(0.5)}, p10 ${q(0.1)}, p90 ${q(0.9)}`);
    for (const n of names) if (results.on[n].error && results.off[n].error) console.log(`[sweep] both fail: ${n}: ${String(results.on[n].error).slice(0, 120)}`);
    expect(diffs).toEqual([]);
  });

  test('perf: Worker init and run times, SES on vs off', async ({ browser }) => {
    test.skip(!process.env.SES_PERF, 'perf — set SES_PERF=1');
    test.setTimeout(3_600_000);
    mkdirSync(OUT, { recursive: true });
    const UNION = `const { Manifold } = api;
const parts = [];
for (let i = 0; i < 64; i++) parts.push(Manifold.sphere(6, 72).translate([(i % 8) * 10, Math.floor(i / 8) * 10, (i % 3) * 2]));
return Manifold.union(parts);`;
    const LEVELSET = `const { Manifold } = api;
const sdf = (p) => Math.sqrt(p[0]*p[0] + p[1]*p[1] + p[2]*p[2]) - 10 + 0.8 * Math.sin(p[0]) * Math.cos(p[1]) * Math.sin(p[2] * 0.7);
return Manifold.levelSet(sdf, { min: [-12, -12, -12], max: [12, 12, 12] }, 0.25);`;
    const cases: Array<{ name: string; code: string; lang: string; n: number }> = [
      { name: 'trivial cube', code: 'const { Manifold } = api;\nreturn Manifold.cube([10, 10, 10], true);', lang: 'manifold-js', n: 15 },
      { name: '64-sphere union (~150k tris)', code: UNION, lang: 'manifold-js', n: 5 },
      { name: 'levelSet + JS closure', code: LEVELSET, lang: 'manifold-js', n: 3 },
      { name: 'SDF figure (cat_calico)', ...catalogCode('cat_calico'), n: 3 },
      { name: 'BOSL2 (modular_drawer_bin)', ...catalogCode('modular_drawer_bin'), n: 2 },
    ];
    const med = (xs: number[]) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const out: Record<string, Record<string, unknown>> = {};
    for (const mode of ['off', 'on'] as const) {
      // Init: a fresh page (so a fresh Worker) per sample.
      const inits: number[] = [];
      for (let i = 0; i < 5; i++) {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await boot(page, mode);
        await runModel(page, cases[0].code, 'manifold-js');
        const info = await page.evaluate(async () => (await import('/src/geometry/engine.ts')).getEngineWorkerReadyInfo());
        if (info?.initMs != null) inits.push(info.initMs);
        await ctx.close();
      }
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await boot(page, mode);
      await runModel(page, cases[0].code, 'manifold-js'); // warm
      const row: Record<string, unknown> = { initMsMedian: med(inits), initMs: inits };
      for (const c of cases) {
        const w: number[] = [];
        let last: RunOut | null = null;
        for (let i = 0; i < c.n; i++) { last = await runModel(page, c.code, c.lang); w.push(last.workerMs ?? NaN); }
        expect(last?.error ?? null, `${mode} ${c.name}`).toBeNull();
        row[c.name] = { workerMsMedian: med(w), samples: w, numTri: last?.numTri };
      }
      out[mode] = row;
      await ctx.close();
    }
    writeFileSync(join(OUT, 'ses-perf.json'), JSON.stringify(out, null, 1));
    const fmt = (v: unknown) => (v as { workerMsMedian: number }).workerMsMedian;
    console.log(`| | SES off | SES on | on/off |\n|---|---|---|---|\n| Worker init (ms) | ${out.off.initMsMedian} | ${out.on.initMsMedian} | +${(out.on.initMsMedian as number) - (out.off.initMsMedian as number)} ms |`);
    for (const c of cases) {
      const a = fmt(out.off[c.name]), b = fmt(out.on[c.name]);
      console.log(`| ${c.name} (ms) | ${a} | ${b} | ${a ? (b / a).toFixed(2) : 'n/a'} |`);
    }
  });
});
