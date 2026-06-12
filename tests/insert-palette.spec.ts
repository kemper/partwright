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
  test('Insert button (Tools popover) toggles the floating palette', async ({ page }) => {
    await gotoEditor(page);
    await expect(page.locator(palette)).toBeHidden();
    await page.locator('#btn-insert').dispatchEvent('click');
    await expect(page.locator(palette)).toBeVisible();
    await page.locator('#btn-insert').dispatchEvent('click');
    await expect(page.locator(palette)).toBeHidden();
  });

  test('insert a cube and a sphere, then subtract via the parts list', async ({ page }) => {
    await gotoEditor(page);
    // Pin a clean placeholder starter so the first insert replaces it (rather
    // than folding into whatever multi-part sampler the landing flow loaded).
    await page.evaluate(() => (window as unknown as { partwright: { setCode(c: string): void; run(): void } })
      .partwright.setCode('const { Manifold } = api;\nreturn Manifold.cube([10, 10, 10], true);'));
    await page.evaluate(() => (window as unknown as { partwright: { run(): void } }).partwright.run());
    await page.locator('#btn-insert').dispatchEvent('click');

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
    await page.locator('#btn-insert').dispatchEvent('click');

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
    await page.locator('#btn-insert').dispatchEvent('click');

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
    await page.locator('#btn-insert').dispatchEvent('click');

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

    await page.locator('#btn-insert').dispatchEvent('click');

    // First insert: the default constructor-call return gets *replaced* by
    // the new part, so the placeholder cube doesn't double up.
    await page.locator(palette).getByRole('button', { name: 'Cube' }).click();
    await page.getByRole('button', { name: 'Insert', exact: true }).click();
    await expect.poll(() => getCode(page)).toMatch(/return\s+box\s*;/);

    // Second insert: the bare-identifier return folds into a readable
    // `Manifold.union([box, ball])` so both shapes stay visible.
    await page.locator(palette).getByRole('button', { name: 'Sphere' }).click();
    await page.getByRole('button', { name: 'Insert', exact: true }).click();
    await expect.poll(() => getCode(page)).toMatch(/return\s+Manifold\.union\(\[box, ball\]\);/);

    // Third insert: the union array grows.
    await page.locator(palette).getByRole('button', { name: 'Cylinder' }).click();
    await page.getByRole('button', { name: 'Insert', exact: true }).click();
    await expect.poll(() => getCode(page)).toMatch(/return\s+Manifold\.union\(\[box, ball, cyl\]\);/);

    // The geometry still renders cleanly (the engine accepted the union).
    const geo = await getGeo(page);
    expect(geo.status).not.toBe('error');
  });

  test('Auto-combine off inserts a part without showing it', async ({ page }) => {
    await gotoEditor(page);
    await page.evaluate(() => (window as unknown as { partwright: { setCode(c: string): void; run(): void } })
      .partwright.setCode('const { Manifold } = api;\nconst widget = Manifold.sphere(8);\nreturn widget;'));
    await page.evaluate(() => (window as unknown as { partwright: { run(): void } }).partwright.run());

    await page.locator('#btn-insert').dispatchEvent('click');
    // Turn Auto-combine off.
    await page.locator('#insert-auto-combine').uncheck();

    await page.locator(palette).getByRole('button', { name: 'Cube' }).click();
    await page.getByRole('button', { name: 'Insert', exact: true }).click();

    // The const is inserted, but the existing return is left untouched.
    await expect.poll(() => getCode(page)).toContain('const box');
    expect(await getCode(page)).toMatch(/return\s+widget\s*;/);
    expect(await getCode(page)).not.toContain('union');
  });

  test('Arrange mode: drag on the real model writes a .translate(...) on commit', async ({ page }) => {
    await gotoEditor(page);
    // Pin a clean starter so the inserted cube is the only / primary part.
    await page.evaluate(() => (window as unknown as { partwright: { setCode(c: string): void; run(): void } })
      .partwright.setCode('const { Manifold } = api;\nreturn Manifold.cube([10, 10, 10], true);'));
    await page.evaluate(() => (window as unknown as { partwright: { run(): void } }).partwright.run());
    await page.locator('#btn-insert').dispatchEvent('click');

    // Insert a centered cube — the real merged model now has a `box` part the
    // arrange-mode raycast will hit at canvas center.
    await page.locator(palette).getByRole('button', { name: 'Cube' }).click();
    await page.getByRole('button', { name: 'Insert', exact: true }).click();
    await expect.poll(() => getCode(page)).toContain('const box');

    // Move the palette panel out of the way so the real-model drag at canvas
    // center isn't intercepted by the panel's DOM hit-test. In production the
    // user drags the panel header to a free corner; here we set position
    // directly. The canvas event listener captures the drag once we're free of
    // the panel.
    await page.evaluate(() => {
      const p = document.querySelector('#insert-palette-panel') as HTMLElement | null;
      if (p) { p.style.left = '8px'; p.style.top = '8px'; p.style.right = 'auto'; p.style.bottom = 'auto'; }
    });

    // Toggle Arrange on. The merged model stays visible (no modal proxy swap);
    // canvas pointer events become select/drag instead of orbit.
    await page.locator('#insert-arrange-toggle').click();
    await expect(page.locator('#insert-arrange-toggle')).toContainText('ON');

    // Drag from canvas center sideways. The pointer-down hits the real cube,
    // pointer-move past the 4px threshold begins the ghost preview, pointer-up
    // commits the delta through writePartTranslateDelta → engine re-runs.
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

    // Toggle Arrange off cleanly.
    await page.locator('#insert-arrange-toggle').click();
    await expect(page.locator('#insert-arrange-toggle')).not.toContainText('ON');
  });

  test('selection strip renders when picking parts via Select mode', async ({ page }) => {
    await gotoEditor(page);
    // Pin a clean starter so the catalog sampler's existing `const box`
    // doesn't satisfy the assertions before our palette insert runs.
    await page.evaluate(() => (window as unknown as { partwright: { setCode(c: string): void; run(): void } })
      .partwright.setCode('const { Manifold } = api;\nreturn Manifold.cube([10, 10, 10], true);'));
    await page.evaluate(() => (window as unknown as { partwright: { run(): void } }).partwright.run());

    await page.locator('#btn-insert').dispatchEvent('click');

    // One centered cube so 3D-pick lands on it reliably.
    await page.locator(palette).getByRole('button', { name: 'Cube' }).click();
    await page.getByRole('button', { name: 'Insert', exact: true }).click();
    await expect.poll(() => getCode(page)).toMatch(/const\s+box\s*=/);

    // Delete quick-action starts disabled — selection is empty.
    const deleteBtn = page.locator(palette).getByRole('button', { name: 'Delete' });
    await expect(deleteBtn).toBeDisabled();

    // Enter Select mode. The instruction bar appears and a chip strip is empty.
    await page.locator(palette).getByRole('button', { name: 'Select' }).click();
    await expect(page.getByText(/Click shapes to toggle selection/i)).toBeVisible();
    await page.locator('canvas').first().click();
    await page.getByRole('button', { name: 'Done', exact: true }).click();

    // After a successful pick the chip strip should hold "box" and Delete is
    // enabled. Scope to the selection strip — the Enclosure "▣ Box" button also
    // contains "box".
    await expect(page.locator('#insert-selection-strip').getByText('box', { exact: false })).toBeVisible({ timeout: 5000 });
    await expect(deleteBtn).toBeEnabled();
  });

  test('Undo / Redo reverses a palette insert and the engine re-runs', async ({ page }) => {
    await gotoEditor(page);
    await page.evaluate(() => (window as unknown as { partwright: { setCode(c: string): void; run(): void } })
      .partwright.setCode('const { Manifold } = api;\nreturn Manifold.cube([10, 10, 10], true);'));
    await page.evaluate(() => (window as unknown as { partwright: { run(): void } }).partwright.run());

    await page.locator('#btn-insert').dispatchEvent('click');

    // Undo / Redo start disabled — no history yet.
    await expect(page.locator('#insert-undo')).toBeDisabled();
    await expect(page.locator('#insert-redo')).toBeDisabled();

    // Insert two parts. After each, Undo enables (Redo stays disabled until an undo).
    await page.locator(palette).getByRole('button', { name: 'Cube' }).click();
    await page.getByRole('button', { name: 'Insert', exact: true }).click();
    await expect.poll(() => getCode(page)).toContain('const box');
    await expect(page.locator('#insert-undo')).toBeEnabled();

    await page.locator(palette).getByRole('button', { name: 'Sphere' }).click();
    await page.getByRole('button', { name: 'Insert', exact: true }).click();
    await expect.poll(() => getCode(page)).toContain('const ball');

    // Undo: the second insert (sphere) goes; cube remains. Redo enables.
    await page.locator('#insert-undo').click();
    await expect.poll(() => getCode(page)).not.toContain('const ball');
    await expect.poll(() => getCode(page)).toContain('const box');
    await expect(page.locator('#insert-redo')).toBeEnabled();

    // Redo: sphere restored.
    await page.locator('#insert-redo').click();
    await expect.poll(() => getCode(page)).toContain('const ball');
  });

  test('Arrange mode: shift+drag draws a marquee that selects parts inside it', async ({ page }) => {
    await gotoEditor(page);
    await page.evaluate(() => (window as unknown as { partwright: { setCode(c: string): void; run(): void } })
      .partwright.setCode('const { Manifold } = api;\nreturn Manifold.cube([10, 10, 10], true);'));
    await page.evaluate(() => (window as unknown as { partwright: { run(): void } }).partwright.run());

    await page.locator('#btn-insert').dispatchEvent('click');

    // Two palette parts so the marquee has something to lasso.
    await page.locator(palette).getByRole('button', { name: 'Cube' }).click();
    await page.getByRole('button', { name: 'Insert', exact: true }).click();
    await expect.poll(() => getCode(page)).toContain('const box');
    await page.locator(palette).getByRole('button', { name: 'Sphere' }).click();
    await page.getByRole('button', { name: 'Insert', exact: true }).click();
    await expect.poll(() => getCode(page)).toContain('const ball');

    // Move the palette out of the way so the canvas drag isn't intercepted.
    await page.evaluate(() => {
      const p = document.querySelector('#insert-palette-panel') as HTMLElement | null;
      if (p) { p.style.left = '8px'; p.style.top = '8px'; p.style.right = 'auto'; }
    });

    await page.locator('#insert-arrange-toggle').click();
    await expect(page.locator('#insert-arrange-toggle')).toContainText('ON');

    // Shift + drag a marquee that covers most of the viewport — the cube/sphere
    // bbox centres at origin project to the canvas centre, so a generous diagonal
    // drag captures both parts.
    const box = await page.locator('canvas').first().boundingBox();
    if (!box) throw new Error('canvas missing');
    const startX = box.x + box.width * 0.85;
    const startY = box.y + box.height * 0.15;
    const endX = box.x + box.width * 0.15;
    const endY = box.y + box.height * 0.85;
    await page.keyboard.down('Shift');
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY, { steps: 12 });
    await page.mouse.up();
    await page.keyboard.up('Shift');

    // Selection chip strip carries BOTH parts.
    await expect(page.locator('#insert-selection-strip').getByText('box', { exact: false })).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#insert-selection-strip').getByText('ball', { exact: false })).toBeVisible();
    // Align section appears (only visible when 2+ selected) — title query targets
    // the row's tooltip since the visible accessible name is just "X ⊣" etc.
    await expect(page.locator(palette).getByTitle(/Align selected parts on X — min surface/)).toBeVisible();
  });

  test('Arrange mode: click on the real model selects + reveals Size/Align sections', async ({ page }) => {
    await gotoEditor(page);
    // Pin a deterministic starter so the catalog sampler's existing parts don't
    // compete with the palette-inserted cube for the arrange-mode raycast.
    await page.evaluate(() => (window as unknown as { partwright: { setCode(c: string): void; run(): void } })
      .partwright.setCode('const { Manifold } = api;\nreturn Manifold.cube([10, 10, 10], true);'));
    await page.evaluate(() => (window as unknown as { partwright: { run(): void } }).partwright.run());

    await page.locator('#btn-insert').dispatchEvent('click');

    // Insert a centered cube so the merged model has a pickable part at the origin.
    await page.locator(palette).getByRole('button', { name: 'Cube' }).click();
    await page.getByRole('button', { name: 'Insert', exact: true }).click();
    await expect.poll(() => getCode(page)).toContain('const box');

    // Toggle Arrange on (replaces the old modal Build mode).
    await page.locator('#insert-arrange-toggle').click();
    await expect(page.locator('#insert-arrange-toggle')).toContainText('ON');

    // Click the cube on the real, merged model — the canvas raycast resolves
    // to the `box` part via the spatial registry. Dispatch directly on the
    // canvas so the always-open palette panel doesn't shadow the hit-test in
    // headless layout.
    const cBox = await page.locator('canvas').first().boundingBox();
    if (!cBox) throw new Error('canvas missing');
    const cx = cBox.x + cBox.width / 2;
    const cy = cBox.y + cBox.height / 2;
    await page.locator('canvas').first().dispatchEvent('pointerdown', { clientX: cx, clientY: cy, button: 0, pointerId: 1, bubbles: true });
    await page.locator('canvas').first().dispatchEvent('pointerup', { clientX: cx, clientY: cy, button: 0, pointerId: 1, bubbles: true });

    // The Size section shows once 1+ parts are selected. The chip strip carries `box`.
    await expect(page.locator('#insert-selection-strip').getByText('box', { exact: false })).toBeVisible({ timeout: 5000 });
    await expect(page.locator(palette).getByRole('button', { name: /Apply size/i })).toBeVisible();
    // The Align section is hidden until a second part is selected. Use a title
    // query since the visible accessible name of each align button is just "X ⊣"
    // (the title carries the descriptive label).
    await expect(page.locator(palette).getByTitle(/Align selected parts on X — min surface/)).toBeHidden();

    // Toggle Arrange off cleanly.
    await page.locator('#insert-arrange-toggle').click();
    await expect(page.locator('#insert-arrange-toggle')).not.toContainText('ON');
  });

  test('partwright API: enterArrange + alignSelection drives the same flow as the panel', async ({ page }) => {
    await gotoEditor(page);
    // Two cubes at different Z so an align('z', 'min') has a visible effect.
    await page.evaluate(() => {
      const code = [
        'const { Manifold } = api;',
        'const box = Manifold.cube([10, 10, 10], true);',
        'const ball = Manifold.sphere(4).translate([20, 0, 8]);',
        'return box.add(ball);',
      ].join('\n');
      (window as unknown as { partwright: { setCode(c: string): void; run(): void } }).partwright.setCode(code);
      (window as unknown as { partwright: { run(): void } }).partwright.run();
    });

    // No UI click: arrange enters via the console API; seeding happens
    // automatically. listArrangeParts surfaces both hand-written parts.
    const { active, parts } = await page.evaluate(() => {
      const w = window as unknown as { partwright: { enterArrange(): { ok: boolean }; isArrangeActive(): boolean; listArrangeParts(): Array<{ name: string }> } };
      w.partwright.enterArrange();
      return { active: w.partwright.isArrangeActive(), parts: w.partwright.listArrangeParts().map(p => p.name) };
    });
    expect(active).toBe(true);
    expect(parts).toContain('box');
    expect(parts).toContain('ball');

    // Select both → align Z 'min'. ball was at z=8; should move down to z=0.
    const result = await page.evaluate(() => {
      const w = window as unknown as { partwright: { selectParts(n: string[]): string[]; alignSelection(a: 'x' | 'y' | 'z', m: 'min' | 'center' | 'max'): { ok: boolean } } };
      w.partwright.selectParts(['box', 'ball']);
      return w.partwright.alignSelection('z', 'min');
    });
    expect(result.ok).toBe(true);

    // The ball's translate should have been re-emitted with a lower Z. We don't
    // pin the exact value (depends on the precise bbox math), but its Z
    // coordinate must drop below the original 8.
    await expect.poll(() => getCode(page)).toMatch(/ball = Manifold\.sphere\(4\)\.translate\(\[[^\]]*, [^,]*, (-?\d+(?:\.\d+)?)\]\)/);
    const code = await getCode(page);
    const m = /ball = Manifold\.sphere\(4\)\.translate\(\[[^,]*,\s*[^,]*,\s*(-?\d+(?:\.\d+)?)\]\)/.exec(code);
    expect(m).not.toBeNull();
    expect(parseFloat(m![1])).toBeLessThan(8);

    // Tidy up.
    await page.evaluate(() => (window as unknown as { partwright: { exitArrange(): void } }).partwright.exitArrange());
  });

  test('partwright API: undo / redo round-trip mirrors the buttons', async ({ page }) => {
    await gotoEditor(page);
    await page.evaluate(() => (window as unknown as { partwright: { setCode(c: string): void; run(): void } })
      .partwright.setCode('const { Manifold } = api;\nreturn Manifold.cube([10, 10, 10], true);'));
    await page.evaluate(() => (window as unknown as { partwright: { run(): void } }).partwright.run());

    await page.locator('#btn-insert').dispatchEvent('click');
    await page.locator(palette).getByRole('button', { name: 'Cube' }).click();
    await page.getByRole('button', { name: 'Insert', exact: true }).click();
    await expect.poll(() => getCode(page)).toContain('const box');

    // API-level undo reverses the insert; canUndo / canRedo agree.
    const before = await page.evaluate(() => (window as unknown as { partwright: { canUndo(): boolean; canRedo(): boolean } }).partwright.canUndo());
    expect(before).toBe(true);
    const label = await page.evaluate(() => (window as unknown as { partwright: { undo(): string | null } }).partwright.undo());
    expect(label).toContain('Insert');
    await expect.poll(() => getCode(page)).not.toContain('const box');

    const canRedo = await page.evaluate(() => (window as unknown as { partwright: { canRedo(): boolean } }).partwright.canRedo());
    expect(canRedo).toBe(true);
    const redoLabel = await page.evaluate(() => (window as unknown as { partwright: { redo(): string | null } }).partwright.redo());
    expect(redoLabel).toContain('Insert');
    await expect.poll(() => getCode(page)).toContain('const box');
  });

  test('hand-written parts seed the arrange registry on enter', async ({ page }) => {
    await gotoEditor(page);
    // Code typed straight into the editor — no palette involvement. The parser
    // recognises Manifold.cube / .sphere with optional .translate.
    await page.evaluate(() => {
      const code = [
        'const { Manifold } = api;',
        'const myCube = Manifold.cube([8, 8, 8], true).translate([10, 0, 0]);',
        'const myBall = Manifold.sphere(3);',
        'return myCube.add(myBall);',
      ].join('\n');
      (window as unknown as { partwright: { setCode(c: string): void; run(): void } }).partwright.setCode(code);
      (window as unknown as { partwright: { run(): void } }).partwright.run();
    });

    const parts = await page.evaluate(() => {
      const w = window as unknown as { partwright: { enterArrange(): unknown; listArrangeParts(): Array<{ name: string; box: { min: number[]; max: number[] } }> } };
      w.partwright.enterArrange();
      return w.partwright.listArrangeParts();
    });
    const names = parts.map(p => p.name);
    expect(names).toContain('myCube');
    expect(names).toContain('myBall');
    // The cube was translated to (10,0,0), centered with size 8 — so its bbox
    // X spans roughly 6..14. The parser should report the correct world bbox.
    const cube = parts.find(p => p.name === 'myCube')!;
    expect(cube.box.min[0]).toBeCloseTo(6, 1);
    expect(cube.box.max[0]).toBeCloseTo(14, 1);

    await page.evaluate(() => (window as unknown as { partwright: { exitArrange(): void } }).partwright.exitArrange());
  });

  test('Arrange mode: drag → undo restores the original position', async ({ page }) => {
    await gotoEditor(page);
    await page.evaluate(() => (window as unknown as { partwright: { setCode(c: string): void; run(): void } })
      .partwright.setCode('const { Manifold } = api;\nreturn Manifold.cube([10, 10, 10], true);'));
    await page.evaluate(() => (window as unknown as { partwright: { run(): void } }).partwright.run());

    await page.locator('#btn-insert').dispatchEvent('click');
    await page.locator(palette).getByRole('button', { name: 'Cube' }).click();
    await page.getByRole('button', { name: 'Insert', exact: true }).click();
    await expect.poll(() => getCode(page)).toContain('const box');
    const codeBeforeDrag = await getCode(page);

    // Move palette out of the canvas's way + enter arrange mode.
    await page.evaluate(() => {
      const p = document.querySelector('#insert-palette-panel') as HTMLElement | null;
      if (p) { p.style.left = '8px'; p.style.top = '8px'; p.style.right = 'auto'; }
    });
    await page.locator('#insert-arrange-toggle').click();

    // Drag the cube right by a sensible amount in screen px so the translate
    // commit visibly shifts +X (the world delta depends on camera, but the
    // direction is right).
    const cBox = await page.locator('canvas').first().boundingBox();
    if (!cBox) throw new Error('canvas missing');
    const cx = cBox.x + cBox.width / 2;
    const cy = cBox.y + cBox.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 100, cy, { steps: 10 });
    await page.mouse.up();

    // After commit, the code includes a translate(...) chain on box.
    await expect.poll(() => getCode(page)).toMatch(/\.translate\(\[/);

    // Undo via the API; the code reverts to its pre-drag form.
    const undone = await page.evaluate(() => (window as unknown as { partwright: { undo(): string | null } }).partwright.undo());
    expect(undone).toContain('Move');
    await expect.poll(() => getCode(page)).toBe(codeBeforeDrag);
  });

  test('partwright API: groupSelection on two parts produces a union in code', async ({ page }) => {
    await gotoEditor(page);
    await page.evaluate(() => {
      const code = [
        'const { Manifold } = api;',
        'const a = Manifold.cube([6, 6, 6], true);',
        'const b = Manifold.sphere(3).translate([4, 0, 0]);',
        'return a.add(b);',
      ].join('\n');
      (window as unknown as { partwright: { setCode(c: string): void; run(): void } }).partwright.setCode(code);
      (window as unknown as { partwright: { run(): void } }).partwright.run();
    });

    const result = await page.evaluate(() => {
      const w = window as unknown as { partwright: { enterArrange(): unknown; selectParts(n: string[]): string[]; groupSelection(): { ok: boolean } } };
      w.partwright.enterArrange();
      w.partwright.selectParts(['a', 'b']);
      return w.partwright.groupSelection();
    });
    expect(result.ok).toBe(true);
    // Union codegen: `const merged = a.add(b);`. The exact result name varies
    // (uniqueName picks merged / merged2 / …), but a new declaration with .add
    // is the signature.
    await expect.poll(() => getCode(page)).toMatch(/const merged\d* = a\.add\(b\);/);

    // Undo reverses the group (the operation goes; `a` and `b` reappear standalone).
    await page.evaluate(() => (window as unknown as { partwright: { undo(): string | null } }).partwright.undo());
    await expect.poll(() => getCode(page)).not.toMatch(/const merged\d* = a\.add\(b\);/);

    await page.evaluate(() => (window as unknown as { partwright: { exitArrange(): void } }).partwright.exitArrange());
  });

  test('session-changed event clears the palette undo history', async ({ page }) => {
    await gotoEditor(page);
    await page.evaluate(() => (window as unknown as { partwright: { setCode(c: string): void; run(): void } })
      .partwright.setCode('const { Manifold } = api;\nreturn Manifold.cube([10, 10, 10], true);'));
    await page.evaluate(() => (window as unknown as { partwright: { run(): void } }).partwright.run());

    // Insert a part to seed the undo stack.
    await page.locator('#btn-insert').dispatchEvent('click');
    await page.locator(palette).getByRole('button', { name: 'Cube' }).click();
    await page.getByRole('button', { name: 'Insert', exact: true }).click();
    await expect.poll(() => getCode(page)).toContain('const box');
    expect(await page.evaluate(() => (window as unknown as { partwright: { canUndo(): boolean } }).partwright.canUndo())).toBe(true);

    // Fire the session-changed event the way the session manager would.
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('session-changed')));

    // History is dropped — canUndo returns false even though the editor still
    // shows code that previously had an Insert step on the stack.
    expect(await page.evaluate(() => (window as unknown as { partwright: { canUndo(): boolean } }).partwright.canUndo())).toBe(false);
  });
});
