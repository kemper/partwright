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

  test('scoped round / weld, editPart and the diffVersions locality check (#1093)', async () => {
    test.setTimeout(120_000);
    const out = await page.evaluate(async () => {
      const api = (window as unknown as { partwright: {
        createSession: (n?: string) => Promise<unknown>;
        run: (code: string) => Promise<unknown>;
        runAndSave: (code: string, label: string) => Promise<unknown>;
        getGeometryData: () => Promise<{ isManifold?: boolean; componentCount?: number; boundingBox?: { x: [number, number]; z: [number, number] } } | null>;
        listObjectParts: () => { parts?: { name: string; triangleCount: number }[] };
        diffVersions: (a: { index: number }, b: { index: number }, o?: unknown) => Promise<Record<string, unknown>>;
      } }).partwright;
      await api.createSession('scoped-ops');
      const probe = async (code: string) => {
        const r = await api.run(code) as { error?: string } | undefined;
        const geo = await api.getGeometryData();
        const parts = Object.fromEntries((api.listObjectParts().parts ?? []).map(p => [p.name, p.triangleCount]));
        return { error: (r && r.error) || null, manifold: geo?.isManifold, components: geo?.componentCount, bbox: geo?.boundingBox, parts };
      };
      const figure = [
        'const { Manifold } = api;',
        "const body = api.label(Manifold.cylinder(24, 7, 6, 48), 'body');",
        "const head = api.label(Manifold.sphere(7, 48).translate([0, 0, 29]), 'head');",
        'const m = body.add(head);',
      ].join('\n');
      const roundTop = await probe("return api.round(api.Manifold.cube([30, 20, 12], true), { radius: 3, select: { where: { facing: 'up' } } });");
      const weld = await probe(figure + "\nreturn api.smoothWeld(body, head, { radius: 2, select: { label: 'head' } });");
      const edit = await probe(figure + "\nreturn api.editPart(m, 'head', { scale: 1.3 });");
      await api.runAndSave(figure + '\nreturn m;', 'before');
      await api.runAndSave(figure + "\nreturn api.editPart(m, 'head', { scale: 1.3 });", 'bigger head');
      const diff = await api.diffVersions({ index: 1 }, { index: 2 }, { geometry: true, render: { size: 128 } });
      const g = diff.geometry as { maxDisplacement: number; changedParts: string[]; parts: { name: string; changedFraction: number }[] } | undefined;
      const frac = (n: string) => g?.parts.find(p => p.name === n)?.changedFraction;
      return {
        roundTop, weld, edit,
        diffError: diff.error ?? null,
        changedParts: g?.changedParts, headMoved: frac('head'), bodyMoved: frac('body'), maxDisplacement: g?.maxDisplacement,
        heatmap: typeof diff.heatmap === 'string' ? (diff.heatmap as string).slice(0, 22) : null,
      };
    });

    // Scoped round: rounded top, the untouched bottom stays exactly on the box.
    expect(out.roundTop.error).toBeNull();
    expect(out.roundTop.manifold).toBe(true);
    expect(out.roundTop.components).toBe(1);
    expect(out.roundTop.bbox!.z[0]).toBeCloseTo(-6, 3);
    // Scoped weld keeps the parts (labels survive outside the zone by construction).
    expect(out.weld.error).toBeNull();
    expect(out.weld.components).toBe(1);
    expect(out.weld.parts.body).toBeGreaterThan(0);
    expect(out.weld.parts.head).toBeGreaterThan(0);
    // editPart: one solid, both parts still labelled, the head grew.
    expect(out.edit.error).toBeNull();
    expect(out.edit.manifold).toBe(true);
    expect(out.edit.components).toBe(1);
    expect(out.edit.parts.head).toBeGreaterThan(0);
    expect(out.edit.parts.body).toBeGreaterThan(0);
    expect(out.edit.bbox!.z[1]).toBeGreaterThan(37);
    // diffVersions: the head moved; of the body only the strip the bigger head
    // now covers did.
    expect(out.diffError).toBeNull();
    expect(out.changedParts).toContain('head');
    expect(out.headMoved!).toBeGreaterThan(0.9);
    expect(out.bodyMoved!).toBeLessThan(0.2);
    expect(out.maxDisplacement).toBeGreaterThan(1);
    expect(out.heatmap).toBe('data:image/png;base64,');
  });

  test('editPart edge cases: whole model, small separate pieces, hollow parts (#1093)', async () => {
    test.setTimeout(120_000);
    const out = await page.evaluate(async () => {
      const api = (window as unknown as { partwright: {
        createSession: (n?: string) => Promise<unknown>;
        run: (code: string) => Promise<unknown>;
        getGeometryData: () => Promise<{ isManifold?: boolean; componentCount?: number; genus?: number; volume?: number; boundingBox?: { x: [number, number] } } | null>;
        listObjectParts: () => { parts?: { name: string; triangleCount: number }[] };
      } }).partwright;
      await api.createSession('edit-part-edges');
      const probe = async (code: string) => {
        const r = await api.run(code) as { error?: string } | undefined;
        const geo = await api.getGeometryData();
        const parts = Object.fromEntries((api.listObjectParts().parts ?? []).map(p => [p.name, p.triangleCount]));
        return { error: (r && r.error) || null, components: geo?.componentCount, genus: geo?.genus, volume: geo?.volume, bbox: geo?.boundingBox, parts };
      };
      return {
        // Selecting everything: the edit applies to the whole model.
        whole: await probe("const { Manifold } = api;\nreturn api.editPart(api.label(Manifold.cube([10, 10, 10], true), 'body'), 'body', { scale: 1.5 });"),
        // A small separate labelled pin elsewhere must survive an edit of the body.
        pin: await probe([
          'const { Manifold } = api;',
          "const body = api.label(Manifold.cube([60, 60, 60], true), 'body');",
          "const base = api.label(Manifold.cube([80, 80, 4], true).translate([0, 0, -40]), 'base');",
          "const pin = api.label(Manifold.sphere(0.8, 24).translate([38, 0, -36]), 'pin');",
          "return api.editPart(body.add(base).add(pin), 'body', { translate: [0, 0, 5] });",
        ].join('\n')),
        // A hollow head keeps its (scaled) cavity.
        hollow: await probe([
          'const { Manifold } = api;',
          "const body = api.label(Manifold.cylinder(24, 7, 6, 48), 'body');",
          "const head = api.label(Manifold.sphere(7, 48).subtract(Manifold.sphere(4, 48)).translate([0, 0, 29]), 'head');",
          "return api.editPart(body.add(head), 'head', { scale: 1.3 });",
        ].join('\n')),
        // A scoped round that would erase the selected area errors like plain round.
        thin: await probe("const { Manifold } = api;\nreturn api.round(Manifold.cube([30, 30, 1], true), { radius: 2, select: { where: { facing: 'up' } } });"),
      };
    });

    expect(out.whole.error).toBeNull();
    expect(out.whole.bbox!.x[1]).toBeCloseTo(7.5, 3);
    expect(out.pin.error).toBeNull();
    expect(out.pin.parts.pin).toBeGreaterThan(0);
    expect(out.pin.components).toBe(3);
    expect(out.hollow.error).toBeNull();
    expect(out.hollow.components).toBe(2); // the solid + its cavity
    expect(out.thin.error).toMatch(/rounds the selected area away/);
  });
});
