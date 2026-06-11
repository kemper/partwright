import { test, expect } from 'playwright/test';

// When the code editor is parked near the very bottom, real Chrome snaps the
// visible code by a line whenever CodeMirror re-measures (a focus change, a
// layout reflow from opening a tool menu/panel, or its own measure loop). The
// bottom-scroll stabilizer (`installBottomScrollStabilizer` in
// src/editor/codeEditor.ts) reverts that unsolicited one-line snap while always
// honoring genuine scrolling. These tests pin down that behaviour by simulating
// the programmatic snap (which is what we can't get headless Chrome to produce
// on its own) and by exercising the user-intent escape hatches.

function longCode(): string {
  const lines: string[] = [];
  lines.push('const { Manifold } = api;');
  lines.push('let m = Manifold.cube([10, 10, 10], true);');
  for (let i = 0; i < 160; i++) lines.push(`// filler comment line ${i} ----------------------------------`);
  lines.push('return m;');
  return lines.join('\n');
}

async function setupScrolledToBottom(page: import('playwright/test').Page): Promise<void> {
  await page.goto('/editor');
  await page.waitForFunction(() => !!(window as unknown as { partwright?: unknown }).partwright, null, { timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.evaluate(async (code: string) => {
    const pw = (window as unknown as { partwright: { createSession?: (n: string) => Promise<unknown>; run: (c: string) => Promise<unknown> } }).partwright;
    if (pw.createSession) { try { await pw.createSession('blur-scroll'); } catch { /* a session may already be open */ } }
    await pw.run(code);
  }, longCode());
  await page.waitForTimeout(1200);
  await page.evaluate(() => (document.querySelector('.cm-content') as HTMLElement)?.focus());
  await page.waitForTimeout(80);
  await page.keyboard.press('Control+End');
  await page.waitForTimeout(100);
  await page.evaluate(() => { const sc = document.querySelector('.cm-scroller') as HTMLElement; sc.scrollTop = sc.scrollHeight; });
  // Wait past the stabilizer's input-grace window so a subsequent programmatic
  // nudge counts as "unsolicited" (the setup's own scroll/keys don't bleed in).
  await page.waitForTimeout(450);
}

const scrollTop = (page: import('playwright/test').Page): Promise<number> =>
  page.evaluate(() => Math.round((document.querySelector('.cm-scroller') as HTMLElement).scrollTop));

const blur = (page: import('playwright/test').Page): Promise<void> =>
  page.evaluate(() => (document.activeElement as HTMLElement)?.blur());

// Simulate the engine/browser snap: a small programmatic scrollTop change with
// no preceding user-input event (no wheel/key/pointer).
const programmaticNudge = (page: import('playwright/test').Page, by: number): Promise<void> =>
  page.evaluate((d) => { (document.querySelector('.cm-scroller') as HTMLElement).scrollTop += d; }, by);

const programmaticSet = (page: import('playwright/test').Page, to: number): Promise<void> =>
  page.evaluate((t) => { (document.querySelector('.cm-scroller') as HTMLElement).scrollTop = t; }, to);

test.describe('editor bottom-scroll stabilizer', () => {
  test('reverts an unsolicited one-line snap at the bottom (after blur)', async ({ page }) => {
    await setupScrolledToBottom(page);
    const atBottom = await scrollTop(page);

    await blur(page);
    await page.waitForTimeout(20);
    await programmaticNudge(page, -40); // the measure snap
    await page.waitForTimeout(120);

    expect(await scrollTop(page)).toBe(atBottom);
  });

  test('reverts an unsolicited snap even while the editor stays focused', async ({ page }) => {
    await setupScrolledToBottom(page);
    const atBottom = await scrollTop(page);

    // No blur, no user input — e.g. a re-measure from a background reflow/timer.
    await programmaticNudge(page, -36);
    await page.waitForTimeout(120);

    expect(await scrollTop(page)).toBe(atBottom);
  });

  test('honors a scroll that follows a real keystroke (typing at the bottom)', async ({ page }) => {
    await setupScrolledToBottom(page);
    const atBottom = await scrollTop(page);

    // A keystroke marks user intent; a scroll right after must be left alone
    // (otherwise typing/paging at the bottom would fight the stabilizer).
    await page.keyboard.press('ArrowUp');
    await programmaticNudge(page, -36);
    await page.waitForTimeout(120);

    expect(await scrollTop(page)).toBeLessThan(atBottom); // the move stood
  });

  test('honors a small scroll after a keystroke anywhere in the editor (find-next path)', async ({ page }) => {
    await setupScrolledToBottom(page);
    const atBottom = await scrollTop(page);

    // The find panel lives outside .cm-scroller, so its keystrokes are caught on
    // view.dom (.cm-editor). Simulate that: a keydown on the editor root marks
    // intent, so a small near-bottom scroll right after it is left alone.
    await page.evaluate(() => {
      const ed = document.querySelector('.cm-editor') as HTMLElement;
      ed.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await programmaticNudge(page, -36);
    await page.waitForTimeout(120);

    expect(await scrollTop(page)).toBeLessThan(atBottom); // honored, not reverted
  });

  test('does not block a large programmatic scroll (real navigation)', async ({ page }) => {
    await setupScrolledToBottom(page);

    await blur(page);
    await page.waitForTimeout(20);
    await programmaticSet(page, 200); // a jump, e.g. reveal-diagnostic
    await page.waitForTimeout(140);

    expect(await scrollTop(page)).toBeLessThan(400);
  });

  test('does not engage away from the bottom', async ({ page }) => {
    await setupScrolledToBottom(page);
    await programmaticSet(page, 1000);
    await page.waitForTimeout(100);

    await blur(page);
    await page.waitForTimeout(20);
    await programmaticNudge(page, -40);
    await page.waitForTimeout(120);

    expect(await scrollTop(page)).toBe(960); // nudge stands; stabilizer inert mid-document
  });
});
