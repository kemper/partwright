// End-to-end coverage for the click-to-insert palette: toolbar toggle, shape
// parameter modals, code insertion + live render, and the three operand modes
// for boolean operations. The 3D-pick raycast math is unit-tested separately
// (tests/insert-codegen.spec.ts); here we verify the session UI round-trip.

import { test, expect, type Page } from 'playwright/test';

test.beforeEach(async ({ page }) => {
  // Suppress the first-run guided tour — its backdrop intercepts clicks.
  await page.addInitScript(() => {
    try { localStorage.setItem('partwright-tour-completed', '1'); } catch { /* ignore */ }
  });
});

async function gotoEditor(page: Page): Promise<void> {
  await page.goto('/editor');
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { help?: unknown } }).partwright?.help,
  );
  // Wait for the default model to render so the engine is warm.
  await page.waitForFunction(
    () => {
      try {
        const g = (window as unknown as { partwright: { getGeometryData(): Record<string, unknown> } })
          .partwright.getGeometryData();
        return !!g && g.status !== 'error' && (Number(g.componentCount) >= 1 || g.isManifold === true);
      } catch {
        return false;
      }
    },
    null,
    { timeout: 30000 },
  );
}

function getCode(page: Page): Promise<string> {
  return page.evaluate(
    () => (window as unknown as { partwright: { getCode(): string } }).partwright.getCode(),
  );
}

function getGeo(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(
    () => (window as unknown as { partwright: { getGeometryData(): Record<string, unknown> } })
      .partwright.getGeometryData(),
  );
}

const palette = '#insert-palette-panel';

test.describe('Insert palette', () => {
  test('Insert button (editor header) toggles the floating palette', async ({ page }) => {
    await gotoEditor(page);
    await expect(page.locator(palette)).toBeHidden();
    await page.locator('#btn-insert').click();
    await expect(page.locator(palette)).toBeVisible();
    await page.locator('#btn-insert').click();
    await expect(page.locator(palette)).toBeHidden();
  });

  test('insert a cube and a sphere, then subtract via the parts list', async ({ page }) => {
    await gotoEditor(page);
    await page.locator('#btn-insert').click();

    // Cube
    await page.locator(palette).getByRole('button', { name: 'Cube' }).click();
    await expect(page.getByText('Insert cube')).toBeVisible();
    await page.getByRole('button', { name: 'Insert', exact: true }).click();
    await expect.poll(() => getCode(page)).toContain('Manifold.cube');

    // Sphere
    await page.locator(palette).getByRole('button', { name: 'Sphere' }).click();
    await expect(page.getByText('Insert sphere')).toBeVisible();
    await page.getByRole('button', { name: 'Insert', exact: true }).click();
    await expect.poll(() => getCode(page)).toContain('Manifold.sphere');

    // Both parts should be named (box, ball) and present.
    const afterShapes = await getCode(page);
    expect(afterShapes).toContain('const box');
    expect(afterShapes).toContain('const ball');

    // Subtract via the list.
    await page.locator(palette).getByRole('button', { name: 'Subtract' }).click();
    await expect(page.getByText('Subtract shapes')).toBeVisible();
    await page.getByRole('button', { name: 'box', exact: true }).click();
    await page.getByRole('button', { name: 'ball', exact: true }).click();
    await page.getByRole('button', { name: /Create subtract/i }).click();

    const finalCode = await getCode(page);
    expect(finalCode).toContain('.subtract(');
    expect(finalCode).toMatch(/return\s+cut\s*;/);

    // Result still renders without error.
    await expect
      .poll(async () => {
        const g = await getGeo(page);
        return g.status !== 'error';
      })
      .toBe(true);
  });

  test('wrap editor selection as an operand', async ({ page }) => {
    // The default AI-drawer-open state collapses the editor pane, hiding
    // `.cm-content`. This test specifically needs to select text in the
    // editor, so pin it open ahead of the page load.
    await page.addInitScript(() => {
      try { localStorage.setItem('partwright-ai-settings-v1', JSON.stringify({ editorCollapsed: false })); } catch { /* ignore */ }
    });
    await gotoEditor(page);
    await page.locator('#btn-insert').click();

    // Two shapes to start.
    await page.locator(palette).getByRole('button', { name: 'Cube' }).click();
    await page.getByRole('button', { name: 'Insert', exact: true }).click();
    await page.locator(palette).getByRole('button', { name: 'Sphere' }).click();
    await page.getByRole('button', { name: 'Insert', exact: true }).click();

    // Select the whole document in the editor.
    await page.locator('.cm-content').click();
    await page.keyboard.press('ControlOrMeta+a');

    await page.locator(palette).getByRole('button', { name: 'Union' }).click();
    await expect(page.getByText('Union shapes')).toBeVisible();
    await page.getByRole('button', { name: /Use editor selection/i }).click();
    // A selection chip should appear.
    await expect(page.getByText(/selection \(/)).toBeVisible();
  });

  test('3D-pick session opens an instruction bar and returns to the dialog', async ({ page }) => {
    await gotoEditor(page);
    await page.locator('#btn-insert').click();

    // Insert two separated cubes so the registry has pickable parts.
    await page.locator(palette).getByRole('button', { name: 'Cube' }).click();
    await page.getByRole('button', { name: 'Insert', exact: true }).click();
    await page.locator(palette).getByRole('button', { name: 'Cube' }).click();
    // Move the second cube aside.
    const posInputs = page.getByText('Position (x, y, z)').locator('xpath=following-sibling::div').locator('input');
    await posInputs.nth(0).fill('25');
    await page.getByRole('button', { name: 'Insert', exact: true }).click();

    await page.locator(palette).getByRole('button', { name: 'Intersect' }).click();
    await expect(page.getByText('Intersect shapes')).toBeVisible();
    await page.getByRole('button', { name: /Pick in 3D view/i }).click();

    // The dialog closes; a non-blocking instruction bar appears over the canvas.
    await expect(page.getByText(/Click shapes for intersect/i)).toBeVisible();

    // Clicking the canvas must not throw; then Done returns to the dialog.
    await page.locator('canvas').first().click({ position: { x: 200, y: 200 } });
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.getByText('Intersect shapes')).toBeVisible();
  });

  test('extended shape catalog inserts and renders each shape', async ({ page }) => {
    await gotoEditor(page);
    await page.locator('#btn-insert').click();

    const tryShape = async (label: string, modalTitle: string, expectedSnippet: RegExp): Promise<void> => {
      await page.locator(palette).getByRole('button', { name: label }).click();
      await expect(page.getByText(modalTitle, { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Insert', exact: true }).click();
      await expect.poll(() => getCode(page)).toMatch(expectedSnippet);
      // No engine errors after insertion.
      const geo = await getGeo(page);
      expect(geo.status).not.toBe('error');
    };

    await tryShape('Torus', 'Insert torus', /CrossSection\.circle\([^)]+\)\.translate\(\[[^\]]+\]\)\.revolve/);
    await tryShape('N-gon', 'Insert polygon', /CrossSection\.ofPolygons/);
    await tryShape('Tet', 'Insert tetrahedron', /Manifold\.tetrahedron\(\)/);
    await tryShape('Dome', 'Insert hemisphere', /Manifold\.sphere\([^)]+\)\.intersect/);

    // CrossSection-using shapes should have added CrossSection to the destructure.
    const code = await getCode(page);
    expect(code).toMatch(/const\s*\{[^}]*\bCrossSection\b[^}]*\}\s*=\s*api\b/);
  });

  test('subsequent shape inserts extend the return into a union (additive default)', async ({ page }) => {
    await gotoEditor(page);
    // Pin a deterministic starter so the assertions don't depend on which
    // catalog template the landing flow happens to load.
    await page.evaluate(() => (window as unknown as { partwright: { setCode(c: string): void; run(): void } })
      .partwright.setCode('const { Manifold } = api;\nreturn Manifold.cube([10, 10, 10], true);'));
    await page.evaluate(() => (window as unknown as { partwright: { run(): void } }).partwright.run());

    await page.locator('#btn-insert').click();

    // First insert: the default constructor-call return gets *replaced* by
    // the new part, so the placeholder cube doesn't double up.
    await page.locator(palette).getByRole('button', { name: 'Cube' }).click();
    await page.getByRole('button', { name: 'Insert', exact: true }).click();
    await expect.poll(() => getCode(page)).toMatch(/return\s+box\s*;/);

    // Second insert: the bare-identifier return is *extended* into
    // `box.add(ball);` so both shapes stay visible without manual Union.
    await page.locator(palette).getByRole('button', { name: 'Sphere' }).click();
    await page.getByRole('button', { name: 'Insert', exact: true }).click();
    await expect.poll(() => getCode(page)).toMatch(/return\s+box\.add\(ball\);/);

    // Third insert: the chain grows by another `.add(...)`.
    await page.locator(palette).getByRole('button', { name: 'Cylinder' }).click();
    await page.getByRole('button', { name: 'Insert', exact: true }).click();
    await expect.poll(() => getCode(page)).toMatch(/return\s+box\.add\(ball\)\.add\(cyl\);/);

    // The geometry still renders cleanly (the engine accepted the union chain).
    const geo = await getGeo(page);
    expect(geo.status).not.toBe('error');
  });

  test('Build mode freehand body-drag rewrites the part translate', async ({ page }) => {
    await gotoEditor(page);
    await page.locator('#btn-insert').click();

    // Insert a centered cube so the proxy renders at the canvas center.
    await page.locator(palette).getByRole('button', { name: 'Cube' }).click();
    await page.getByRole('button', { name: 'Insert', exact: true }).click();
    await expect.poll(() => getCode(page)).toContain('const box');

    // Enter Build mode.
    await page.locator(palette).getByRole('button', { name: 'Build' }).click();
    await expect(page.getByText(/Build mode/i)).toBeVisible();

    // Drag the proxy body (not the gizmo arrows) — start at canvas center,
    // move a couple of hundred pixels away. Pointermove past the 4px threshold
    // engages the freehand drag; pointerup commits the translate.
    const box = await page.locator('canvas').first().boundingBox();
    if (!box) throw new Error('canvas missing');
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 150, startY + 50, { steps: 10 });
    await page.mouse.up();

    // The cube declaration should now carry a non-zero .translate(...).
    await expect.poll(() => getCode(page)).toMatch(/Manifold\.cube\([^)]+\)\.translate\(\[/);

    // Exit cleanly.
    await page.getByRole('button', { name: 'Done', exact: true }).click();
  });

  test('selection strip renders when picking parts via Select mode', async ({ page }) => {
    await gotoEditor(page);
    await page.locator('#btn-insert').click();

    // One centered cube so 3D-pick lands on it reliably.
    await page.locator(palette).getByRole('button', { name: 'Cube' }).click();
    await page.getByRole('button', { name: 'Insert', exact: true }).click();
    await expect.poll(() => getCode(page)).toContain('const box');

    // Delete quick-action starts disabled — selection is empty.
    const deleteBtn = page.locator(palette).getByRole('button', { name: 'Delete' });
    await expect(deleteBtn).toBeDisabled();

    // Enter Select mode. The instruction bar appears and a chip strip is empty.
    await page.locator(palette).getByRole('button', { name: 'Select' }).click();
    await expect(page.getByText(/Click shapes to toggle selection/i)).toBeVisible();
    await page.locator('canvas').first().click();
    await page.getByRole('button', { name: 'Done', exact: true }).click();

    // After a successful pick the chip strip should hold "box" and Delete is enabled.
    await expect(page.locator(palette).getByText('box', { exact: false })).toBeVisible({ timeout: 5000 });
    await expect(deleteBtn).toBeEnabled();
  });

  test('build mode: shapes render separately, select + gizmo session runs', async ({ page }) => {
    await gotoEditor(page);
    await page.locator('#btn-insert').click();

    // Insert a centered cube so the build scene has a pickable part at the origin.
    await page.locator(palette).getByRole('button', { name: 'Cube' }).click();
    await page.getByRole('button', { name: 'Insert', exact: true }).click();

    // Enter build mode (closes the palette, hides the merged mesh, shows proxies).
    await page.locator(palette).getByRole('button', { name: 'Build' }).click();
    await expect(page.getByText(/Build mode/i)).toBeVisible();

    // Click the framed proxy at canvas-center to select it — constructs the
    // TransformControls gizmo (verifies the path doesn't throw headless).
    await page.locator('canvas').first().click();
    await expect(page.getByText(/Selected/i)).toBeVisible({ timeout: 5000 });

    // Exit cleanly.
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.getByText(/Build mode/i)).toBeHidden();
  });
});
