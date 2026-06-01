import { test, expect } from 'playwright/test';

// Regression guard for the landing-page handoff.
//
// The landing route paints a static "#landing-inline" copy of the page
// (index.html) instantly, then swaps it for the JS-built "#landing-page"
// (src/ui/landing.ts) once the bundle boots — a couple of seconds later. If
// the two pages differ structurally (missing sections, mismatched widths),
// that swap shows up as a jarring layout shift well after first paint. These
// pages were once allowed to drift (the inline copy was missing the "Built
// for AI agents" and "Built on" sections and used a wider max-width on the
// content sections), which is exactly the bug this spec exists to prevent.
//
// The only things that may legitimately change at the swap are the async
// catalog + recent-session tiles, which both pages render as identically
// sized skeletons until their data arrives.

test.describe('Landing inline → JS handoff has no layout shift', () => {
  // The section eyebrows / headings that must appear in BOTH pages.
  const SECTION_HEADINGS = [
    'How it works',
    'What you can build',
    'Built for AI agents',
    'Hand the keyboard to your agent.',
    'Your recent sessions',
    'Built on open foundations',
  ];

  test('inline static page mirrors the JS-built page structure', async ({ page }) => {
    // Snapshot the inline page's structure the instant the DOM is ready —
    // before main.ts (which awaits document.fonts.ready) removes it. Reading
    // it from the test after navigation races the swap, especially with a
    // fast dev bundle, so we capture it inside the page instead.
    await page.addInitScript((headings) => {
      const w = window as unknown as { __inlineSnap?: unknown };
      const snap = () => {
        const li = document.getElementById('landing-inline');
        if (!li) return;
        const text = li.textContent ?? '';
        const howItWorks = [...li.querySelectorAll('section')].find(
          s => /How it works/.test(s.textContent ?? ''),
        );
        w.__inlineSnap = {
          present: true,
          headingsPresent: headings.map((h: string) => text.includes(h)),
          contentWidth: howItWorks ? Math.round(howItWorks.getBoundingClientRect().width) : 0,
        };
      };
      document.addEventListener('DOMContentLoaded', () => requestAnimationFrame(snap));
    }, SECTION_HEADINGS);

    await page.goto('/');

    // Wait for the swap to the JS-built page to complete.
    await page.waitForFunction(() => !document.getElementById('landing-inline'), null, { timeout: 20000 });
    const landing = page.locator('#landing-page');
    await expect(landing).toBeVisible();

    const inline = await page.evaluate(() => (window as unknown as {
      __inlineSnap?: { present: boolean; headingsPresent: boolean[]; contentWidth: number };
    }).__inlineSnap);

    expect(inline?.present, 'inline landing page snapshot should have been captured').toBe(true);
    if (!inline) return;

    // Every section must exist in the static copy — this is what regressed.
    for (let i = 0; i < SECTION_HEADINGS.length; i++) {
      expect(inline.headingsPresent[i], `inline page is missing section: "${SECTION_HEADINGS[i]}"`).toBe(true);
    }

    const js = await page.evaluate((headings) => {
      const p = document.getElementById('landing-page');
      if (!p) return { present: false as const };
      const text = p.textContent ?? '';
      const howItWorks = [...p.querySelectorAll('section')].find(
        s => /How it works/.test(s.textContent ?? ''),
      );
      return {
        present: true as const,
        headingsPresent: headings.map(h => text.includes(h)),
        contentWidth: howItWorks ? Math.round(howItWorks.getBoundingClientRect().width) : 0,
      };
    }, SECTION_HEADINGS);

    expect(js.present).toBe(true);
    if (!js.present) return;

    // Same sections in the JS page (sanity — the source of truth).
    for (let i = 0; i < SECTION_HEADINGS.length; i++) {
      expect(js.headingsPresent[i], `JS page is missing section: "${SECTION_HEADINGS[i]}"`).toBe(true);
    }

    // The content-section width must match across the swap (the 80rem-vs-64rem
    // drift that caused the horizontal reflow). Allow 1px for rounding.
    expect(Math.abs(js.contentWidth - inline.contentWidth)).toBeLessThanOrEqual(1);
  });
});
