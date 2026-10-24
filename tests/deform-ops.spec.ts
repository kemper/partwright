// Blender-parity mesh-shaping verbs, exercised end-to-end in the browser:
// api.scatter / api.wrapAround / api.round / api.smoothWeld / api.sculpt.* run
// inside the geometry Worker and return real manifolds; api.material records a
// viewport shading spec the main thread applies; the 'checker' paint pattern
// resolves into the model-color underlay. One golden-path spec per group.

import { test, expect, type Page } from 'playwright/test';
import { openSharedEditor } from './helpers/sharedPage';

// The API surface the spec drives — typed once, used by every evaluate call.
interface PW {
  createSession: (n?: string) => Promise<unknown>;
  run: (code: string) => Promise<unknown>;
  getGeometryData: () => Promise<{ isManifold?: boolean; componentCount?: number; triangleCount?: number } | null>;
}
const pw = () => (window as unknown as { partwright: PW }).partwright;

// Each test creates its own fresh session via createSession() before running
// its code, so the tests are order-independent — the file shares one booted
// editor instead of paying a fresh page + WASM boot per test.
let page: Page;
test.beforeAll(async ({ browser }, testInfo) => {
  page = await openSharedEditor(browser, testInfo);
});
test.afterAll(async () => {
  await page?.context().close();
});

test.describe('deform ops (scatter / round / weld / sculpt in code)', () => {
  test('scatter + round + smoothWeld + sculpt build valid manifolds in the browser', async () => {
    const out = await page.evaluate(async () => {
      const api = pwHandle();
      await api.createSession('deform-ops');
      const code = [
        'const { Manifold } = api;',
        '// weld two plain spheres, sculpt a bump, round a boolean, scatter studs',
        'const blob = api.smoothWeld(Manifold.sphere(10, 32), Manifold.sphere(7, 32).translate([0, 0, 11]), { radius: 3 });',
        'const bumped = api.sculpt.inflate(blob, { at: [0, -9, 4], radius: 6, amount: 2 });',
        'const plus = Manifold.cube([20, 8, 8], true).add(Manifold.cube([8, 20, 8], true));',
        'const rounded = api.round(plus, { radius: 1.5 }).translate([28, 0, 0]);',
        'const stud = Manifold.cylinder(2, 1.2, 1.2, 12);',
        'const studs = api.scatter(bumped, stud, { count: 24, seed: 2, offset: -0.6, minSpacing: 3 });',
        'return bumped.add(studs).add(rounded);',
      ].join('\n');
      const r = await api.run(code) as { error?: string } | undefined;
      const geo = await api.getGeometryData();
      return { runError: (r && r.error) || null, geo };

      function pwHandle() {
        return (window as unknown as { partwright: {
          createSession: (n?: string) => Promise<unknown>;
          run: (code: string) => Promise<unknown>;
          getGeometryData: () => Promise<{ isManifold?: boolean; componentCount?: number; triangleCount?: number } | null>;
        } }).partwright;
      }
    });

    expect(out.runError).toBeNull();
    expect(out.geo?.isManifold).toBe(true);
    // The welded blob (+ fused studs) and the rounded plus = 2 components.
    expect(out.geo?.componentCount).toBe(2);
  });

  test('wrapAround wraps text-sized geometry and api.material reaches the viewport', async () => {
    const out = await page.evaluate(async () => {
      const api = (window as unknown as { partwright: {
        createSession: (n?: string) => Promise<unknown>;
        run: (code: string) => Promise<unknown>;
        getGeometryData: () => Promise<{ isManifold?: boolean; componentCount?: number } | null>;
      } }).partwright;
      await api.createSession('wrap-material');
      const code = [
        'const { Manifold } = api;',
        "api.material({ preset: 'brass', roughness: 0.4 });",
        'const body = Manifold.cylinder(30, 12, 12, 64);',
        '// a flat ridge strip, wrapped as an embossed band around the cylinder',
        'const strip = Manifold.cube([50, 2, 6], true).translate([0, 0.4, 15]);',
        'const band = api.wrapAround(strip, { radius: 11.5 });',
        'return body.add(band);',
      ].join('\n');
      const r = await api.run(code) as { error?: string } | undefined;
      const geo = await api.getGeometryData();
      const viewport = await import('/src/renderer/viewport.ts');
      return {
        runError: (r && r.error) || null,
        geo,
        material: viewport.getMaterialOverride(),
      };
    });

    expect(out.runError).toBeNull();
    expect(out.geo?.isManifold).toBe(true);
    expect(out.geo?.componentCount).toBe(1);
    // The recorded spec reached the viewport, preset resolved with the override kept.
    expect(out.material?.preset).toBe('brass');
    expect(out.material?.roughness).toBeCloseTo(0.4, 6);
    expect(out.material?.metalness).toBe(1);
  });

  test("the 'checker' paint pattern resolves into the model underlay", async () => {
    const out = await page.evaluate(async () => {
      const api = (window as unknown as { partwright: {
        createSession: (n?: string) => Promise<unknown>;
        run: (code: string) => Promise<unknown>;
      } }).partwright;
      await api.createSession('checker-pattern');
      const code = [
        'const { Manifold } = api;',
        "api.paint.pattern({ pattern: 'checker', colors: ['#e3e6ea', '#b3405b'], scale: 6 });",
        'return Manifold.sphere(15, 48);',
      ].join('\n');
      const r = await api.run(code) as { error?: string } | undefined;
      const regions = await import('/src/color/regions.ts');
      const model = regions.getModelRegions().map(reg => ({
        kind: reg.descriptor.kind,
        tris: reg.triangles.size,
        perTri: reg.perTriColors ? reg.perTriColors.size : 0,
      }));
      return { runError: (r && r.error) || null, model };
    });

    expect(out.runError).toBeNull();
    const pattern = out.model.find(m => m.kind === 'pattern');
    expect(pattern).toBeTruthy();
    expect(pattern!.tris).toBeGreaterThan(100);
    // checker assigns a per-triangle color to every scoped triangle
    expect(pattern!.perTri).toBe(pattern!.tris);
  });

  test('select confines sculpt / deform / scatter to one part (#1093)', async () => {
    const out = await page.evaluate(async () => {
      const api = (window as unknown as { partwright: {
        createSession: (n?: string) => Promise<unknown>;
        run: (code: string) => Promise<unknown>;
        getGeometryData: () => Promise<{ isManifold?: boolean; componentCount?: number; boundingBox?: { x: number[]; y: number[]; z: number[] } } | null>;
      } }).partwright;
      await api.createSession('selectors');
      const code = [
        'const { Manifold } = api;',
        "const body = api.label(Manifold.cylinder(30, 10, 10, 48), 'body');",
        "const head = api.label(Manifold.sphere(9, 48).translate([0, 0, 36]), 'head');",
        "const arm = api.label(Manifold.cube([24, 5, 5], true).translate([18, 0, 22]), 'arm');",
        'let m = body.add(head).add(arm);',
        "m = api.sculpt.transform(m, { select: { label: 'head' }, scale: 1.4, blend: 3 });",
        "m = api.twist(m, { select: { label: 'arm' }, degrees: 90, axis: 'x' });",
        "const spikes = api.scatter(m, Manifold.cylinder(3, 0.8, 0, 8), { count: 20, seed: 2, offset: -0.4, where: { label: 'head', where: { facing: 'up', tolerance: 50 } } });",
        'return m.add(spikes);',
      ].join('\n');
      const r = await api.run(code) as { error?: string } | undefined;
      const geo = await api.getGeometryData();
      // The ops warp vertices without remeshing, so every label keeps its faces.
      const parts = await (window as unknown as { partwright: { listObjectParts: () => { parts?: { name: string; triangleCount: number }[] } } }).partwright.listObjectParts();
      const partTris = Object.fromEntries((parts.parts ?? []).map(p => [p.name, p.triangleCount]));
      const bad = await api.run("const { Manifold } = api; return api.sculpt.transform(api.label(Manifold.cube(5), 'a'), { select: { label: 'nope' }, scale: 2 });") as { error?: string } | undefined;
      const badGeo = await api.getGeometryData() as { error?: string } | null;
      return { runError: (r && r.error) || null, geo, partTris, badError: (bad && bad.error) || badGeo?.error || '' };
    });

    expect(out.runError).toBeNull();
    expect(out.geo?.isManifold).toBe(true);
    expect(out.geo?.componentCount).toBe(1);
    // The head (radius 9 → 12.6) now sets the Y extent; the body is untouched below it.
    const bb = out.geo!.boundingBox!;
    expect(bb.y[1] - bb.y[0]).toBeCloseTo(25.2, 0);
    expect(bb.z[0]).toBeCloseTo(0, 3);
    expect(out.partTris.head).toBeGreaterThan(0);
    expect(out.partTris.arm).toBeGreaterThan(0);
    expect(out.partTris.body).toBeGreaterThan(0);
    // An unknown part is a loud, actionable error — not a silent no-op.
    expect(out.badError).toContain('no part "nope"');
  });

  test('keepLabels carries api.label parts through round / smoothWeld (#1093)', async () => {
    const out = await page.evaluate(async () => {
      const api = (window as unknown as { partwright: {
        createSession: (n?: string) => Promise<unknown>;
        run: (code: string) => Promise<unknown>;
        getGeometryData: () => Promise<{ isManifold?: boolean; componentCount?: number } | null>;
        listObjectParts: () => { parts?: { name: string; triangleCount: number }[] };
      } }).partwright;
      await api.createSession('keep-labels');
      const tris = async (code: string) => {
        const r = await api.run(code) as { error?: string } | undefined;
        const geo = await api.getGeometryData();
        const parts = Object.fromEntries((api.listObjectParts().parts ?? []).map(p => [p.name, p.triangleCount]));
        return { error: (r && r.error) || null, manifold: geo?.isManifold, components: geo?.componentCount, parts };
      };
      const head = [
        'const { Manifold } = api;',
        "const body = api.label(Manifold.cylinder(30, 10, 10, 48), 'body');",
        "const head = api.label(Manifold.sphere(9, 48).translate([0, 0, 36]), 'head');",
      ].join('\n');
      return {
        weldKeep: await tris(head + "\nreturn api.smoothWeld(body, head, { radius: 3, keepLabels: true });"),
        weldDrop: await tris(head + "\nreturn api.smoothWeld(body, head, { radius: 3 });"),
        roundKeep: await tris(head + "\nreturn api.round(body.add(head), { radius: 1.5, keepLabels: true });"),
      };
    });

    expect(out.weldKeep.error).toBeNull();
    expect(out.weldKeep.manifold).toBe(true);
    expect(out.weldKeep.components).toBe(1);
    expect(out.weldKeep.parts.body).toBeGreaterThan(0);
    expect(out.weldKeep.parts.head).toBeGreaterThan(0);
    // Off by default: existing models keep their old (label-dropping) result.
    expect(out.weldDrop.parts.head ?? 0).toBe(0);
    expect(out.roundKeep.error).toBeNull();
    expect(out.roundKeep.parts.body).toBeGreaterThan(0);
    expect(out.roundKeep.parts.head).toBeGreaterThan(0);
  });
});
