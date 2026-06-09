import { test, expect } from 'playwright/test';

// When the code editor is scrolled to the very bottom and loses focus (e.g. the
// user clicks away to drag a tool panel), real Chrome can nudge the visible code
// up by a line or two — a deferred focus-change re-measure re-clamps max-scroll.
// `pinScrollAfterBlur` (src/editor/codeEditor.ts) holds the scroll offset steady
// for a short window after blur so the code doesn't stutter, while still letting
// any genuine scroll through. These tests pin down that behaviour.

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
  await page.waitForTimeout(150);
}

const scrollTop = (page: import('playwright/test').Page): Promise<number> =>
  page.evaluate(() => Math.round((document.querySelector('.cm-scroller') as HTMLElement).scrollTop));

const blur = (page: import('playwright/test').Page): Promise<void> =>
  page.evaluate(() => (document.activeElement as HTMLElement)?.blur());

const nudgeScroll = (page: import('playwright/test').Page, by: number): Promise<void> =>
  page.evaluate((d) => { (document.querySelector('.cm-scroller') as HTMLElement).scrollTop += d; }, by);

const setScroll = (page: import('playwright/test').Page, to: number): Promise<void> =>
  page.evaluate((t) => { (document.querySelector('.cm-scroller') as HTMLElement).scrollTop = t; }, to);

test.describe('editor blur scroll pin', () => {
  test('reverts a small post-blur scroll nudge at the bottom', async ({ page }) => {
    await setupScrolledToBottom(page);
    const atBottom = await scrollTop(page);

    await blur(page);
    await page.waitForTimeout(20);
    await nudgeScroll(page, -40); // simulate Chrome's 2-line nudge
    await page.waitForTimeout(140);

    expect(await scrollTop(page)).toBe(atBottom);
  });

  test('does not block a large programmatic scroll after blur', async ({ page }) => {
    await setupScrolledToBottom(page);

    await blur(page);
    await page.waitForTimeout(20);
    await setScroll(page, 200); // a real jump (e.g. reveal-diagnostic)
    await page.waitForTimeout(160);

    expect(await scrollTop(page)).toBeLessThan(400);
  });

  test('does not engage when the editor is not at the bottom', async ({ page }) => {
    await setupScrolledToBottom(page);
    await setScroll(page, 1000);
    await page.waitForTimeout(100);

    await blur(page);
    await page.waitForTimeout(20);
    await nudgeScroll(page, -40);
    await page.waitForTimeout(140);

    expect(await scrollTop(page)).toBe(960); // nudge stands; guard inert away from bottom
  });
});
