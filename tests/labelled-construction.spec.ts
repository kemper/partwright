// Verifies api.label / api.labeledUnion + paintByLabel end-to-end:
// labels survive boolean ops, resolve to non-empty triangle sets, and
// the painted region carries the right counts. The Phase 0 verification
// (tests/manifold-id-verify.spec.ts) already confirms manifold-3d's
// runOriginalID semantics — this is the integration test on top.

import { test, expect } from 'playwright/test';

test.describe('labelled construction', () => {
  test('api.label registers names and paintByLabel resolves them', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 15000 });

    // Three-feature model: head sphere + two eye spheres that overlap
    // the head. After boolean union, each triangle is attributed to
    // exactly one input by runOriginalID — so paintByLabel('eyeL')
    // should pick up only the visible eye-surface triangles, even
    // though the eye geometry sticks into the head.
    const ran = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const r = await pw.run(`
        const { Manifold } = api;
        const head = api.label(Manifold.sphere(20, 64), 'head');
        const eyeL = api.label(Manifold.sphere(5, 32).translate([-8, 14, 5]), 'eyeL');
        const eyeR = api.label(Manifold.sphere(5, 32).translate([ 8, 14, 5]), 'eyeR');
        return head.add(eyeL).add(eyeR);
      `);
      return r;
    });
    expect(ran.error, ran.error ? ran.error : 'expected clean run').toBeUndefined();

    const labels = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      return pw.listLabels();
    });
    expect(labels.count).toBe(3);
    const byName = Object.fromEntries(
      (labels.labels as { name: string; triangleCount: number }[]).map(l => [l.name, l]),
    );
    expect(byName.head).toBeDefined();
    expect(byName.eyeL).toBeDefined();
    expect(byName.eyeR).toBeDefined();
    expect(byName.head.triangleCount).toBeGreaterThan(0);
    expect(byName.eyeL.triangleCount).toBeGreaterThan(0);
    expect(byName.eyeR.triangleCount).toBeGreaterThan(0);
    // Head is the dominant input; eyes are small spheres mostly
    // hidden inside the head. Head triangles >> eye triangles.
    expect(byName.head.triangleCount).toBeGreaterThan(byName.eyeL.triangleCount);

    const painted = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      return pw.paintByLabel({ label: 'eyeL', color: [0, 0, 1] });
    });
    expect(painted.error).toBeUndefined();
    expect(painted.triangles).toBe(byName.eyeL.triangleCount);
    expect(painted.name).toBe('eyeL');

    // Unknown label produces an instructive error mentioning known labels.
    const miss = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      return pw.paintByLabel({ label: 'mouth', color: [1, 0, 0] });
    });
    expect(typeof miss.error).toBe('string');
    expect(miss.error).toContain('mouth');
    expect(miss.error).toMatch(/head|eyeL|eyeR/);
  });

  test('unlabeled model returns empty label list', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 15000 });

    await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.run('return api.Manifold.cube([10, 10, 10]);');
    });
    const labels = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      return pw.listLabels();
    });
    expect(labels.count).toBe(0);
    expect(labels.labels).toEqual([]);

    const painted = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      return pw.paintByLabel({ label: 'anything', color: [1, 0, 0] });
    });
    expect(painted.error).toContain('No labels registered');
  });

  test('api.labeledUnion is sugar for label + add chain', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 15000 });

    const ran = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      return pw.run(`
        const { Manifold } = api;
        return api.labeledUnion([
          { name: 'base',    shape: Manifold.cube([20, 20, 5], true) },
          { name: 'pillarA', shape: Manifold.cylinder(15, 2, 2, 16).translate([-6, 0, 2.5]) },
          { name: 'pillarB', shape: Manifold.cylinder(15, 2, 2, 16).translate([ 6, 0, 2.5]) },
        ]);
      `);
    });
    expect(ran.error).toBeUndefined();

    const labels = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      return pw.listLabels();
    });
    expect(labels.count).toBe(3);
    const names = (labels.labels as { name: string }[]).map(l => l.name).sort();
    expect(names).toEqual(['base', 'pillarA', 'pillarB']);
  });
});
