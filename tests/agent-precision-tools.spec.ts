// E2E coverage for the small-feature tooling agents asked for (#1197):
//  - renderView / renderViews / probePixel `focus` (zoom onto a labelled part
//    or a world box) and `clip` (hide everything outside that box),
//  - modifyAndTest returning the patched code's console logs,
//  - api.raycast / api.closestPoint inside model code.
// All driven through window.partwright on one shared editor page.

import { test, expect, type Page } from 'playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { openSharedEditor } from './helpers/sharedPage';

let page: Page;
test.beforeAll(async ({ browser }, testInfo) => {
  page = await openSharedEditor(browser, testInfo);
});
test.afterAll(async () => {
  await page?.context().close();
});

// A closed hollow shell with a small labelled peg floating inside it: the peg
// can only be seen by clipping the shell away.
const SHELL_WITH_PEG = [
  'const { Manifold } = api;',
  'const shell = Manifold.cube([20, 20, 20], true).subtract(Manifold.cube([16, 16, 16], true));',
  "return api.labeledUnion([{ name: 'shell', shape: shell }, { name: 'peg', shape: Manifold.cube([2, 2, 2], true) }]);",
].join('\n');

function savePng(dataUrl: unknown, file: string): void {
  if (typeof dataUrl !== 'string') return;
  mkdirSync('test-results', { recursive: true });
  writeFileSync(`test-results/${file}`, Buffer.from(dataUrl.split(',')[1], 'base64'));
}

test.describe('agent precision tools', () => {
  test('focus zooms onto a part; clip sees past the geometry in front of it', async () => {
    const out = await page.evaluate(async (code) => {
      type View = Record<string, unknown>;
      const pw = (window as unknown as { partwright: {
        createSession: (n?: string) => Promise<unknown>;
        runAndSave: (code: string, label?: string) => Promise<unknown>;
        renderView: (o?: View) => unknown;
        renderViews: (o?: View) => Promise<unknown>;
        probePixel: (o: { pixel: [number, number]; view: View }) => { point?: number[]; error?: string } | null;
        probePixels: (p: [number, number][], v: View) => { results?: { point?: number[] }[]; error?: string };
      } }).partwright;
      await pw.createSession('focus');
      await pw.runAndSave(code, 'shell + peg');
      const view = { focus: 'peg', elevation: 30, azimuth: 315, size: 256 };
      return {
        whole: pw.renderView({ size: 256 }),
        zoomed: pw.renderView(view),
        clipped: pw.renderView({ ...view, clip: true }),
        clippedViews: await pw.renderViews({ focus: { min: [-1, -1, -1], max: [1, 1, 1] }, padding: 1, clip: true, size: 192 }),
        // The centre pixel of the zoomed view: the shell's outside without clip,
        // the peg with it.
        unclippedHit: pw.probePixel({ pixel: [128, 128], view }),
        clippedHit: pw.probePixel({ pixel: [128, 128], view: { ...view, clip: true } }),
        clippedBatch: pw.probePixels([[128, 128]], { ...view, clip: true }),
        badPart: pw.renderView({ focus: 'nope' }),
        clipWithoutFocus: pw.renderView({ clip: true }),
        badBox: pw.renderView({ focus: { min: [1, 1, 1], max: [0, 0, 0] } }),
      };
    }, SHELL_WITH_PEG);

    for (const k of ['whole', 'zoomed', 'clipped', 'clippedViews'] as const) {
      expect(typeof out[k], k).toBe('string');
      expect(String(out[k]).startsWith('data:image/png'), k).toBe(true);
    }
    expect(out.zoomed).not.toBe(out.whole);
    expect(out.clipped).not.toBe(out.zoomed);
    savePng(out.whole, 'focus-whole.png');
    savePng(out.zoomed, 'focus-zoomed.png');
    savePng(out.clipped, 'focus-clipped.png');

    const maxAbs = (p?: number[]) => Math.max(...(p ?? [99]).map(Math.abs));
    expect(maxAbs(out.unclippedHit?.point)).toBeGreaterThan(9.9);  // the shell's outer wall
    expect(maxAbs(out.clippedHit?.point)).toBeLessThanOrEqual(1.01); // the peg
    expect(maxAbs(out.clippedBatch.results?.[0]?.point)).toBeLessThanOrEqual(1.01);
    expect(String((out.badPart as { error?: string }).error)).toMatch(/unknown part or piece "nope"/);
    expect(String((out.clipWithoutFocus as { error?: string }).error)).toMatch(/clip needs a focus/);
    expect(String((out.badBox as { error?: string }).error)).toMatch(/min must be <= max/);
  });

  test('modifyAndTest returns the patched code\'s console logs', async () => {
    const out = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: {
        createSession: (n?: string) => Promise<unknown>;
        runAndSave: (code: string, label?: string) => Promise<unknown>;
        modifyAndTest: (fn: (c: string) => string, a?: Record<string, unknown>) => Promise<Record<string, unknown>>;
      } }).partwright;
      await pw.createSession('modify-logs');
      await pw.runAndSave('const { Manifold } = api;\nconst s = 4;\nreturn Manifold.cube([s, s, s]);', 'base');
      const ok = await pw.modifyAndTest(c => c.replace('const s = 4;', "const s = 6; console.log('size', s);"), { isManifold: true });
      const quiet = await pw.modifyAndTest(c => c.replace('const s = 4;', 'const s = 5;'));
      const failed = await pw.modifyAndTest(c => c.replace('const s = 4;', "console.log('about to fail'); throw new Error('nope');"));
      return { ok, quiet, failed };
    });
    expect(out.ok.logs).toEqual(['size 6']);
    expect(out.ok.passed).toBe(true);
    expect(out.quiet.logs).toBeUndefined();
    expect(out.failed.logs).toEqual(['about to fail']);
  });

  test('api.raycast and api.closestPoint read the surface from model code', async () => {
    const out = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: {
        runIsolated: (code: string) => Promise<{ logs?: string[]; error?: string; geometryData?: { status?: string; error?: string } }>;
      } }).partwright;
      const code = [
        'const { Manifold } = api;',
        'const box = Manifold.cube([10, 10, 10], true);',
        // A 45° hole: a slice sees only part of it; a ray down its axis finds the floor.
        'const hole = Manifold.cylinder(30, 1.5, 1.5, 32, true).rotate([45, 0, 0]);',
        'const part = box.subtract(hole.translate([0, 0, 5]).intersect(Manifold.cube([20, 20, 4], true).translate([0, 0, 5])));',
        'const first = api.raycast(box, [0, 0, 20], [0, 0, -1]);',
        'const all = api.raycast(box, [0, 0, 20], [0, 0, -2], { all: true });',
        'const short = api.raycast(box, [0, 0, 20], [0, 0, -1], { maxDistance: 10 });',
        'const outside = api.closestPoint(box, [0, 0, 8]);',
        'const inside = api.closestPoint(box, [1, 1, 4]);',
        'const viaMeshOps = api.meshOps.closestPoint(part, [0, 0, 8]);',
        'console.log(JSON.stringify({ first, all, short, outside, inside, viaMeshOps: !!viaMeshOps }));',
        'return part;',
      ].join('\n');
      const r = await pw.runIsolated(code);
      let bad: unknown = null;
      try { bad = await pw.runIsolated('const { Manifold } = api; api.raycast(Manifold.cube(1), [0, 0, 0], [0, 0, 0]); return Manifold.cube(1);'); } catch (e) { bad = String(e); }
      return { logs: r.logs, status: r.geometryData?.status, err: r.geometryData?.error, bad };
    });
    expect(out.err).toBeUndefined();
    expect(out.status).not.toBe('error');
    const q = JSON.parse(out.logs![0]);
    expect(q.first.point[2]).toBeCloseTo(5);
    expect(q.first.distance).toBeCloseTo(15);
    expect(q.first.entering).toBe(true);
    expect(q.first.normal).toEqual([0, 0, 1]);
    expect(q.all.map((h: { entering: boolean }) => h.entering)).toEqual([true, false]);
    expect(q.short).toBeNull();
    expect(q.outside.distance).toBeCloseTo(3);
    expect(q.outside.inside).toBe(false);
    expect(q.inside.inside).toBe(true);
    expect(q.inside.distance).toBeCloseTo(1);
    expect(q.viaMeshOps).toBe(true);
    expect(JSON.stringify(out.bad)).toMatch(/direction must not be \[0,0,0\]/);
  });
});
