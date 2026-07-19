// Blender-parity mesh-shaping verbs, exercised end-to-end in the browser:
// api.scatter / api.wrapAround / api.round / api.smoothWeld / api.sculpt.* run
// inside the geometry Worker and return real manifolds; api.material records a
// viewport shading spec the main thread applies; the 'checker' paint pattern
// resolves into the model-color underlay. One golden-path spec per group.

import { test, expect, type Page } from 'playwright/test';

async function waitForEngine(page: Page) {
  await page.waitForSelector('text=Ready', { timeout: 20_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    { timeout: 20_000 },
  );
}

// The API surface the spec drives — typed once, used by every evaluate call.
interface PW {
  createSession: (n?: string) => Promise<unknown>;
  run: (code: string) => Promise<unknown>;
  getGeometryData: () => Promise<{ isManifold?: boolean; componentCount?: number; triangleCount?: number } | null>;
}
const pw = () => (window as unknown as { partwright: PW }).partwright;

test.describe('deform ops (scatter / round / weld / sculpt in code)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
  });

  test('scatter + round + smoothWeld + sculpt build valid manifolds in the browser', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);

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

  test('wrapAround wraps text-sized geometry and api.material reaches the viewport', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);

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

  test("the 'checker' paint pattern resolves into the model underlay", async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);

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
});
